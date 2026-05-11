import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OAuthTokenError,
  verifyOAuthToken,
  __resetJwksCacheForTest,
} from '../../src/auth/oauthVerify.js'

const ISSUER = 'https://as.example.com'
const AUDIENCE = 'http://localhost:3000/mcp'
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`

interface Keypair {
  privateKey: KeyObject
  publicKey: KeyObject
  kid: string
}

const makeKeypair = (kid: string): Keypair => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { privateKey, publicKey, kid }
}

const jwkFor = (kp: Keypair): Record<string, unknown> => {
  const jwk = kp.publicKey.export({ format: 'jwk' })
  return { ...jwk, kid: kp.kid, alg: 'RS256', use: 'sig' }
}

const jwksBodyFor = (kps: Keypair[]): { keys: Record<string, unknown>[] } => ({
  keys: kps.map(jwkFor),
})

const makeFetchMock = (
  responder: (url: string) => { ok?: boolean; status?: number; body?: unknown } | Promise<never>,
) => {
  return vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const r = await responder(url)
    const ok = r.ok ?? true
    const status = r.status ?? 200
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => r.body,
    } as Response
  })
}

interface SignOpts {
  sub?: string | null
  iss?: string
  aud?: string | string[]
  scope?: string | string[] | null
  expiresIn?: number
  algorithm?: jwt.Algorithm
  key?: KeyObject | string
  kid?: string | null
  extraPayload?: Record<string, unknown>
}

const signToken = (kp: Keypair, opts: SignOpts = {}): string => {
  const payload: Record<string, unknown> = {
    iss: opts.iss ?? ISSUER,
    aud: opts.aud ?? AUDIENCE,
    ...(opts.extraPayload ?? {}),
  }
  if (opts.sub !== null) payload.sub = opts.sub ?? 'user-1'
  if (opts.scope !== null && opts.scope !== undefined) payload.scope = opts.scope
  const header: jwt.SignOptions['header'] = { alg: opts.algorithm ?? 'RS256' }
  const kid = opts.kid === undefined ? kp.kid : opts.kid
  if (kid !== null) header.kid = kid
  return jwt.sign(payload, opts.key ?? kp.privateKey, {
    algorithm: opts.algorithm ?? 'RS256',
    expiresIn: opts.expiresIn ?? 60 * 15,
    header,
  })
}

let kpA: Keypair
let kpB: Keypair
let foreignKp: Keypair

beforeEach(() => {
  __resetJwksCacheForTest()
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER)
  vi.stubEnv('MCP_CANONICAL_URI', AUDIENCE)
  kpA = makeKeypair('kid-a')
  kpB = makeKeypair('kid-b')
  foreignKp = makeKeypair('kid-a') // 같은 kid 주장하지만 다른 키
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('verifyOAuthToken — accept', () => {
  it('happy path: RS256 + 정상 claim → { userId, scopes }', async () => {
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-42', scope: 'read:calendar write:calendar' })

    const auth = await verifyOAuthToken(token)
    expect(auth).toEqual({
      userId: 'u-42',
      scopes: ['read:calendar', 'write:calendar'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(JWKS_URL)
  })

  it('공백 구분 scope string을 split', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', scope: 'read:calendar  write:calendar' })
    const auth = await verifyOAuthToken(token)
    expect(auth.scopes).toEqual(['read:calendar', 'write:calendar'])
  })

  it('scope 누락 → 빈 배열', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', scope: null })
    const auth = await verifyOAuthToken(token)
    expect(auth.scopes).toEqual([])
  })

  it('scope이 non-string (배열) → 빈 배열', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, {
      sub: 'u-1',
      scope: null,
      extraPayload: { scope: ['read:calendar'] },
    })
    const auth = await verifyOAuthToken(token)
    expect(auth.scopes).toEqual([])
  })
})

describe('verifyOAuthToken — reject', () => {
  it('만료 (31분 후) → Expired', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', expiresIn: 60 * 30 })

    vi.setSystemTime(new Date('2026-01-01T00:31:00Z'))
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Expired' })
  })

  it('iss 다름 → IssuerMismatch', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', iss: 'https://other.example.com' })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'IssuerMismatch' })
  })

  it('aud 다름 → AudienceMismatch', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', aud: 'http://other.example.com/mcp' })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'AudienceMismatch' })
  })

  it('aud가 배열 → AudienceMismatch (single string 만 인정)', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: 'u-1', aud: [AUDIENCE] })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'AudienceMismatch' })
  })

  it('sub 누락 → MissingSub', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(kpA, { sub: null })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'MissingSub' })
  })

  it('header.kid 누락 → UnknownKid', async () => {
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1', kid: null })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'UnknownKid' })
    // header에서 미리 차단되므로 JWKS fetch도 발생하지 않아야 정상
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('빈 캐시 + JWKS에 없는 kid → fetch 1회만 후 UnknownKid (방금 fetch했으므로 rotation 재fetch 생략)', async () => {
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1', kid: 'kid-unknown' })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'UnknownKid' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('캐시 적중 후 새 kid 도착 → rotation 재fetch 1회 + 여전히 없으면 UnknownKid (총 2회)', async () => {
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)

    // 첫 호출 — kid-A 캐시
    await verifyOAuthToken(signToken(kpA, { sub: 'u-1' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 두 번째 — kid-unknown 도착, TTL 안 만료여도 rotation 재fetch 발생
    const tokenUnknown = signToken(kpA, { sub: 'u-1', kid: 'kid-unknown' })
    await expect(verifyOAuthToken(tokenUnknown)).rejects.toMatchObject({ reason: 'UnknownKid' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('HS256 토큰 → Invalid (alg 화이트리스트)', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: 'u-1' }, 'shared-secret', {
      algorithm: 'HS256',
      expiresIn: 60 * 15,
      header: { alg: 'HS256', kid: kpA.kid },
    })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('none alg 토큰 → Invalid', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: 'u-1' }, '', {
      algorithm: 'none',
      expiresIn: 60 * 15,
      header: { alg: 'none', kid: kpA.kid },
    })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('다른 RSA 키로 서명한 토큰 (위조) → Invalid', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = signToken(foreignKp, { sub: 'u-1', kid: kpA.kid })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('손상된 토큰 (not.a.jwt) → Invalid', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    await expect(verifyOAuthToken('not.a.jwt')).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('string payload → Invalid', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    const token = jwt.sign('raw-string', kpA.privateKey, {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: kpA.kid },
    })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })
})

describe('JWKS cache', () => {
  it('두 번째 호출은 캐시 적중 → fetch 추가 호출 없음', async () => {
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1' })

    await verifyOAuthToken(token)
    await verifyOAuthToken(token)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('TTL (5분 1초) 만료 후 → 재fetch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const fetchMock = makeFetchMock(() => ({ body: jwksBodyFor([kpA]) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1', expiresIn: 60 * 60 })

    await verifyOAuthToken(token)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))
    await verifyOAuthToken(token)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('key rotation: 캐시에 kid-A → kid-B 도착 시 TTL 안 만료여도 재fetch 후 통과', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      expect(url).toBe(JWKS_URL)
      callCount += 1
      // 1번째 호출: kid-A만, 2번째 호출: kid-A + kid-B
      const body = callCount === 1 ? jwksBodyFor([kpA]) : jwksBodyFor([kpA, kpB])
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    // 첫 호출 — kid-A 캐시 적재
    const tokenA = signToken(kpA, { sub: 'u-1' })
    await verifyOAuthToken(tokenA)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 두 번째 — kid-B 도착, TTL 안 만료여도 재fetch 발생 + kid-B 발견되면 통과
    const tokenB = signToken(kpB, { sub: 'u-2' })
    const auth = await verifyOAuthToken(tokenB)
    expect(auth.userId).toBe('u-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('JWKS fetch network error + stale 캐시 없음 → Invalid', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1' })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('JWKS fetch http 5xx + stale 캐시 없음 → Invalid', async () => {
    const fetchMock = makeFetchMock(() => ({ ok: false, status: 503, body: null }))
    vi.stubGlobal('fetch', fetchMock)
    const token = signToken(kpA, { sub: 'u-1' })
    await expect(verifyOAuthToken(token)).rejects.toMatchObject({ reason: 'Invalid' })
  })

  it('stale 캐시 fallback: TTL 만료 후 fetch 실패해도 기존 키로 통과', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => jwksBodyFor([kpA]),
        } as Response
      }
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    const token = signToken(kpA, { sub: 'u-1', expiresIn: 60 * 60 })
    await verifyOAuthToken(token)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // TTL 만료 후 재fetch는 실패하지만 stale 캐시로 통과
    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))
    const auth = await verifyOAuthToken(token)
    expect(auth.userId).toBe('u-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('env validation', () => {
  it('MCP_OAUTH_ISSUER 누락 → throw', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    vi.stubEnv('MCP_OAUTH_ISSUER', '')
    const token = signToken(kpA, { sub: 'u-1' })
    await expect(verifyOAuthToken(token)).rejects.toThrow(/MCP_OAUTH_ISSUER/)
  })

  it('MCP_CANONICAL_URI 누락 → throw', async () => {
    vi.stubGlobal('fetch', makeFetchMock(() => ({ body: jwksBodyFor([kpA]) })))
    vi.stubEnv('MCP_CANONICAL_URI', '')
    const token = signToken(kpA, { sub: 'u-1' })
    await expect(verifyOAuthToken(token)).rejects.toThrow(/MCP_CANONICAL_URI/)
  })
})

// OAuthTokenError shape sanity
describe('OAuthTokenError', () => {
  it('reason discriminator 노출', () => {
    const err = new OAuthTokenError('Expired', 'msg')
    expect(err.reason).toBe('Expired')
    expect(err.name).toBe('OAuthTokenError')
    expect(err.message).toBe('msg')
  })
})
