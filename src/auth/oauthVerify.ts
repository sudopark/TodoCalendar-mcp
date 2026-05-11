import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { requireEnv } from '../internal/env.js'

const JWKS_TTL_MS = 5 * 60 * 1000

export interface OAuthAuth {
  userId: string
  scopes: string[]
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

const jwksUrl = (issuer: string): string => {
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
  return `${trimmed}/.well-known/jwks.json`
}

const fetchJwks = async (issuer: string): Promise<JwksCacheEntry> => {
  const url = jwksUrl(issuer)
  let res: Response
  try {
    res = await fetch(url)
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

// kid → key 해석.
//   - 캐시 hit + TTL 안 만료 → 그대로
//   - 캐시 miss/만료 → fetch
//   - fetch 후에도 kid 없으면 → (직전 fetch 직후라면) UnknownKid, 아니면 1회 강제 재fetch (rotation 대응)
const resolveKey = async (issuer: string, kid: string): Promise<KeyObject> => {
  const now = Date.now()
  let entry = jwksCache
  let justFetched = false

  if (entry === null || isExpired(entry, now)) {
    try {
      entry = await fetchJwks(issuer)
      jwksCache = entry
      justFetched = true
    } catch (e) {
      // stale 캐시가 있으면 fallback 시도
      if (jwksCache !== null) {
        entry = jwksCache
      } else {
        throw e
      }
    }
  }

  let key = entry.keys.get(kid)
  if (key !== undefined) return key

  // rotation: 캐시에 없으면 1회 강제 재fetch
  if (!justFetched) {
    try {
      const fresh = await fetchJwks(issuer)
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
    const result = jwt.verify(token, publicKey, { algorithms: ['RS256'] })
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

  // RFC 8707: aud는 single string 가정 (Functions #189 합의)
  const decodedAud = typeof decoded.aud === 'string' ? decoded.aud : ''
  if (decodedAud !== expectedAudience) {
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

  return { userId: decodedSub, scopes }
}

// test-only: 모듈 스코프 캐시 초기화
export const __resetJwksCacheForTest = (): void => {
  jwksCache = null
}
