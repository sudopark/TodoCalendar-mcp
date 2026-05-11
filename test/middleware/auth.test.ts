import type { IncomingHttpHeaders } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthTokenError } from '../../src/auth/oauthVerify.js'

const verifyOAuthTokenMock = vi.fn()

vi.mock('../../src/auth/oauthVerify.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/auth/oauthVerify.js')>(
    '../../src/auth/oauthVerify.js',
  )
  return {
    ...actual,
    verifyOAuthToken: (...args: unknown[]) => verifyOAuthTokenMock(...args),
  }
})

const {
  AuthRequiredError,
  DEV_USER_ID_HEADER,
  DEV_SCOPES,
  extractDevAuth,
  extractOAuthAuth,
} = await import('../../src/middleware/auth.js')

beforeEach(() => {
  verifyOAuthTokenMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('extractDevAuth', () => {
  it('헤더에 userId 있으면 Auth 반환 — scopes는 dev 기본값', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: 'u-1' }

    const auth = extractDevAuth(headers)
    expect(auth.userId).toBe('u-1')
    expect(auth.scopes).toEqual([...DEV_SCOPES])
  })

  it('scopes는 dev 기본값 복사 — 반환 배열이 readonly 원본을 노출하지 않음', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: 'u-1' }
    const auth = extractDevAuth(headers)

    auth.scopes.push('mutated')
    const second = extractDevAuth(headers)
    expect(second.scopes).toEqual([...DEV_SCOPES])
  })

  it('헤더 누락 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = {}

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 빈 문자열 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '' }

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 공백만 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '   ' }

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 값 trim — 앞뒤 공백 제거', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '  u-2  ' }

    const auth = extractDevAuth(headers)
    expect(auth.userId).toBe('u-2')
    expect(auth.scopes).toEqual([...DEV_SCOPES])
  })

  it('헤더 값 배열 — 첫 번째 사용', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: ['u-3', 'u-4'] }

    const auth = extractDevAuth(headers)
    expect(auth.userId).toBe('u-3')
  })
})

describe('extractOAuthAuth', () => {
  it('정상 Bearer — verifyOAuthToken 결과 그대로 반환', async () => {
    verifyOAuthTokenMock.mockResolvedValue({
      userId: 'oauth-user',
      scopes: ['read:calendar'],
    })
    const headers: IncomingHttpHeaders = { authorization: 'Bearer abc.def.ghi' }

    await expect(extractOAuthAuth(headers)).resolves.toEqual({
      userId: 'oauth-user',
      scopes: ['read:calendar'],
    })
    expect(verifyOAuthTokenMock).toHaveBeenCalledWith('abc.def.ghi')
  })

  it('Bearer prefix는 대소문자 무관', async () => {
    verifyOAuthTokenMock.mockResolvedValue({ userId: 'u', scopes: [] })
    const headers: IncomingHttpHeaders = { authorization: 'bearer token-xyz' }

    await extractOAuthAuth(headers)
    expect(verifyOAuthTokenMock).toHaveBeenCalledWith('token-xyz')
  })

  it('헤더 누락 — AuthRequiredError, verify 호출 안 함', async () => {
    const headers: IncomingHttpHeaders = {}

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
    expect(verifyOAuthTokenMock).not.toHaveBeenCalled()
  })

  it('빈 문자열 — AuthRequiredError', async () => {
    const headers: IncomingHttpHeaders = { authorization: '' }

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
  })

  it('공백만 — AuthRequiredError', async () => {
    const headers: IncomingHttpHeaders = { authorization: '   ' }

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
  })

  it('Basic scheme — AuthRequiredError (non-Bearer 거부)', async () => {
    const headers: IncomingHttpHeaders = { authorization: 'Basic dXNlcjpwYXNz' }

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
  })

  it('Bearer 단어만, 토큰 없음 — AuthRequiredError', async () => {
    const headers: IncomingHttpHeaders = { authorization: 'Bearer' }

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
  })

  it('Bearer + 공백뿐 — AuthRequiredError', async () => {
    const headers: IncomingHttpHeaders = { authorization: 'Bearer    ' }

    await expect(extractOAuthAuth(headers)).rejects.toThrow(AuthRequiredError)
  })

  it('verifyOAuthToken throw OAuthTokenError → 그대로 propagate (reason 보존)', async () => {
    verifyOAuthTokenMock.mockRejectedValue(new OAuthTokenError('Expired', 'token expired'))
    const headers: IncomingHttpHeaders = { authorization: 'Bearer expired.token.here' }

    await expect(extractOAuthAuth(headers)).rejects.toMatchObject({
      name: 'OAuthTokenError',
      reason: 'Expired',
    })
  })

  it('verifyOAuthToken throw 일반 Error → 그대로 propagate', async () => {
    const networkErr = new TypeError('fetch failed')
    verifyOAuthTokenMock.mockRejectedValue(networkErr)
    const headers: IncomingHttpHeaders = { authorization: 'Bearer x.y.z' }

    await expect(extractOAuthAuth(headers)).rejects.toBe(networkErr)
  })

})
