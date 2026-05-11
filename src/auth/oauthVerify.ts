import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { requireEnv } from '../internal/env.js'

const JWKS_TTL_MS = 5 * 60 * 1000
// stale cache 허용 상한 — fetch 영구 실패 시 revoked key 무기한 통과 방지.
// TTL(5분) 만료 후 STALE_MAX_MS 안이면 fetch 실패 시 stale 사용 가능, 넘으면 throw.
const JWKS_STALE_MAX_MS = 30 * 60 * 1000
const JWKS_FETCH_TIMEOUT_MS = 5000
// jwt exp/nbf 클록 드리프트 허용 — AS·RS 시계 차이로 boundary token 거부 방지.
const CLOCK_TOLERANCE_SECONDS = 30

export interface OAuthAuth {
  userId: string
  scopes: string[]
  clientId?: string
}

export type OAuthTokenReason =
  | 'Expired'
  | 'IssuerMismatch'
  | 'AudienceMismatch'
  | 'MissingSub'
  | 'UnknownKid'
  | 'Invalid'

export class OAuthTokenError extends Error {
  constructor(
    public readonly reason: OAuthTokenReason,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthTokenError'
  }
}

interface JwksCacheEntry {
  keys: Map<string, KeyObject>
  cachedAt: number
}

interface Jwk extends webcrypto.JsonWebKey {
  kid?: string
  alg?: string
  use?: string
}

interface JwksResponse {
  keys: Jwk[]
}

// module-scope cache. test에서 격리할 땐 __resetJwksCacheForTest() 사용.
let jwksCache: JwksCacheEntry | null = null
// in-flight fetch dedupe — 동시 요청이 만료 캐시 만나면 한 번만 fetch.
let jwksInflight: Promise<JwksCacheEntry> | null = null

const jwksUrl = (issuer: string): string => {
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
  return `${trimmed}/.well-known/jwks.json`
}

const fetchJwks = async (issuer: string): Promise<JwksCacheEntry> => {
  const url = jwksUrl(issuer)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) })
  } catch (e) {
    throw new OAuthTokenError(
      'Invalid',
      `jwks fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!res.ok) {
    throw new OAuthTokenError('Invalid', `jwks fetch failed: ${res.status} ${res.statusText}`)
  }
  let body: JwksResponse
  try {
    body = (await res.json()) as JwksResponse
  } catch (e) {
    throw new OAuthTokenError(
      'Invalid',
      `jwks body parse failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!body || !Array.isArray(body.keys)) {
    throw new OAuthTokenError('Invalid', 'jwks body malformed: missing keys array')
  }
  const keys = new Map<string, KeyObject>()
  for (const jwk of body.keys) {
    if (typeof jwk.kid !== 'string' || jwk.kid === '') continue
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' })
      keys.set(jwk.kid, key)
    } catch {
      // 개별 jwk가 손상돼도 다른 키는 살림
      continue
    }
  }
  return { keys, cachedAt: Date.now() }
}

const isExpired = (entry: JwksCacheEntry, now: number): boolean =>
  now - entry.cachedAt >= JWKS_TTL_MS

const isStaleBeyondMax = (entry: JwksCacheEntry, now: number): boolean =>
  now - entry.cachedAt >= JWKS_STALE_MAX_MS

// 동시 fetch dedupe — 같은 fetch promise를 공유.
const fetchJwksDeduped = async (issuer: string): Promise<JwksCacheEntry> => {
  if (jwksInflight !== null) return jwksInflight
  jwksInflight = fetchJwks(issuer).finally(() => {
    jwksInflight = null
  })
  return jwksInflight
}

// kid → key 해석.
//   - 캐시 hit + TTL 안 만료 → 그대로
//   - 캐시 miss/만료 → fetch (in-flight dedupe). 실패 시 stale 캐시가 STALE_MAX_MS 안이면 fallback.
//   - fetch 후에도 kid 없으면 → (직전 fetch 직후라면) UnknownKid, 아니면 1회 강제 재fetch (rotation 대응)
const resolveKey = async (issuer: string, kid: string): Promise<KeyObject> => {
  const now = Date.now()
  let entry = jwksCache
  let justFetched = false
  let staleFallback = false

  if (entry === null || isExpired(entry, now)) {
    try {
      entry = await fetchJwksDeduped(issuer)
      jwksCache = entry
      justFetched = true
    } catch (e) {
      // stale fallback — STALE_MAX_MS 안이어야. 넘으면 revoked key 우려라 throw.
      if (jwksCache !== null && !isStaleBeyondMax(jwksCache, now)) {
        entry = jwksCache
        staleFallback = true
      } else {
        throw e
      }
    }
  }

  let key = entry.keys.get(kid)
  if (key !== undefined) return key

  // rotation: 캐시에 없으면 1회 강제 재fetch.
  // stale fallback 경로면 건너뜀 — 방금 fetch 실패한 endpoint를 다시 두드리는 건 의미 없음.
  if (!justFetched && !staleFallback) {
    try {
      const fresh = await fetchJwksDeduped(issuer)
      jwksCache = fresh
      key = fresh.keys.get(kid)
      if (key !== undefined) return key
    } catch (e) {
      // 재fetch 실패면 stale 그대로 — kid 못 찾았다는 결론은 동일
      if (!(e instanceof OAuthTokenError)) throw e
    }
  }

  throw new OAuthTokenError('UnknownKid', `unknown kid: ${kid}`)
}

const decodeHeader = (token: string): { kid: string } => {
  const decoded = jwt.decode(token, { complete: true })
  if (decoded === null || typeof decoded !== 'object') {
    throw new OAuthTokenError('Invalid', 'token decode failed')
  }
  const header = decoded.header as { kid?: unknown } | undefined
  if (header === undefined || typeof header.kid !== 'string' || header.kid === '') {
    throw new OAuthTokenError('UnknownKid', 'token header missing kid')
  }
  return { kid: header.kid }
}

const parseScopes = (raw: unknown): string[] => {
  if (typeof raw !== 'string') return []
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export const verifyOAuthToken = async (token: string): Promise<OAuthAuth> => {
  const expectedIssuer = requireEnv('MCP_OAUTH_ISSUER')
  const expectedAudience = requireEnv('MCP_CANONICAL_URI')

  let kid: string
  try {
    kid = decodeHeader(token).kid
  } catch (e) {
    if (e instanceof OAuthTokenError) throw e
    throw new OAuthTokenError(
      'Invalid',
      `token decode failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const publicKey = await resolveKey(expectedIssuer, kid)

  let decoded: jwt.JwtPayload
  try {
    const result = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    })
    if (typeof result === 'string' || result === null) {
      throw new OAuthTokenError('Invalid', 'unexpected string payload')
    }
    decoded = result
  } catch (e) {
    if (e instanceof OAuthTokenError) throw e
    if (e instanceof jwt.TokenExpiredError) {
      throw new OAuthTokenError('Expired', 'access token expired')
    }
    throw new OAuthTokenError(
      'Invalid',
      `access token invalid: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const decodedIss = typeof decoded.iss === 'string' ? decoded.iss : ''
  if (decodedIss !== expectedIssuer) {
    throw new OAuthTokenError(
      'IssuerMismatch',
      `access token issuer "${decodedIss}" does not match expected "${expectedIssuer}"`,
    )
  }

  // RFC 7519 §4.1.3 / RFC 8707: aud는 string 또는 string[]. multi-RS 확장 대비.
  const audMatches =
    (typeof decoded.aud === 'string' && decoded.aud === expectedAudience) ||
    (Array.isArray(decoded.aud) && decoded.aud.includes(expectedAudience))
  if (!audMatches) {
    throw new OAuthTokenError(
      'AudienceMismatch',
      `access token audience does not match expected "${expectedAudience}"`,
    )
  }

  const decodedSub = typeof decoded.sub === 'string' ? decoded.sub : ''
  if (decodedSub === '') {
    throw new OAuthTokenError('MissingSub', 'access token missing sub claim')
  }

  const scopes = parseScopes(decoded.scope)
  const clientId = typeof decoded.client_id === 'string' ? decoded.client_id : undefined

  return { userId: decodedSub, scopes, clientId }
}

// test-only: 모듈 스코프 캐시 초기화.
// production code가 부르면 throw — 우연 노출 방지.
export const __resetJwksCacheForTest = (): void => {
  const vitestFlag = process.env['VITEST']
  const isTestEnv =
    process.env['NODE_ENV'] === 'test' ||
    (typeof vitestFlag === 'string' && vitestFlag !== '')
  if (!isTestEnv) {
    throw new Error('__resetJwksCacheForTest is for tests only')
  }
  jwksCache = null
  jwksInflight = null
}
