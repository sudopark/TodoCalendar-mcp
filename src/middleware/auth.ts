import type { IncomingHttpHeaders } from 'node:http'
import type { Auth } from '../auth/types.js'
import { OAuthTokenError, verifyOAuthToken } from '../auth/oauthVerify.js'

export const DEV_USER_ID_HEADER = 'x-dev-user-id' as const
export const DEV_SCOPES: readonly string[] = ['read:calendar', 'write:calendar']

export class AuthRequiredError extends Error {
  override readonly name = 'AuthRequiredError'
  constructor(message: string) {
    super(message)
  }
}

export type AuthExtractor = (headers: IncomingHttpHeaders) => Promise<Auth>

const headerValue = (headers: IncomingHttpHeaders, key: string): string | undefined => {
  const raw = headers[key.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

export const extractDevAuth = (headers: IncomingHttpHeaders): Auth => {
  const userId = headerValue(headers, DEV_USER_ID_HEADER)?.trim()
  if (userId === undefined || userId === '') {
    throw new AuthRequiredError(`${DEV_USER_ID_HEADER} header is required`)
  }
  return { userId, scopes: [...DEV_SCOPES] }
}

const BEARER_PATTERN = /^Bearer\s+(.+)$/i

// OAuth Resource Server entry. Bearer 파싱·verifyOAuthToken delegate.
// OAuthTokenError는 그대로 위로 통과시켜 server.ts가 reason별로 401 (WWW-Authenticate) 분기 가능하게.
// 헤더 자체가 빈 경우(token 누락·non-Bearer)는 AuthRequiredError — 401 invalid_request.
export const extractOAuthAuth: AuthExtractor = async (headers) => {
  const raw = headerValue(headers, 'authorization')?.trim()
  if (raw === undefined || raw === '') {
    throw new AuthRequiredError('Authorization header is required')
  }
  const match = BEARER_PATTERN.exec(raw)
  const token = match?.[1]?.trim() ?? ''
  if (match === null) {
    throw new AuthRequiredError('Authorization header must be Bearer scheme')
  }
  if (token === '') {
    throw new AuthRequiredError('Bearer token is empty')
  }
  return await verifyOAuthToken(token)
}

// Re-export so server.ts can pattern-match on the auth verifier's typed reason
// without importing oauthVerify directly.
export { OAuthTokenError }
