import type { IncomingHttpHeaders } from 'node:http'
import type { Request, RequestHandler } from 'express'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { Auth } from '../auth/types.js'
import { OAuthTokenError, verifyOAuthToken } from '../auth/oauthVerify.js'
import { buildWwwAuthenticate, metadataUrlFrom } from './wwwAuthenticate.js'

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

// req.auth는 MCP SDK Streamable HTTP transport가 핸들러 extra로 propagate하는 면.
// 미들웨어가 세팅, downstream 핸들러(mcpRequestHandler)에서 읽음.
export type AuthedRequest = Request & { auth?: AuthInfo }

export interface McpAuthOptions {
  extractor: AuthExtractor
  /** token `aud` 비교에 사용하는 본 server canonical URI. WWW-Authenticate realm·resource_metadata 빌드용. */
  canonicalUri?: string
}

// Auth 미들웨어 — extractor 호출·401+WWW-Authenticate 응답·req.auth 세팅 책임.
// extractor가 throw하면 reason별 (OAuthTokenError → invalid_token / AuthRequiredError → challenge only)로
// RFC 6750 응답. 그 외 throw는 next(e)로 위임 (Express error handler 또는 500).
export const mcpAuth = (options: McpAuthOptions): RequestHandler => {
  const metadataUrl = metadataUrlFrom(options.canonicalUri)
  return async (req, res, next): Promise<void> => {
    let auth: Auth
    try {
      auth = await options.extractor(req.headers)
    } catch (e) {
      if (e instanceof OAuthTokenError) {
        res.setHeader(
          'WWW-Authenticate',
          buildWwwAuthenticate(options.canonicalUri, metadataUrl, { error: 'invalid_token' }),
        )
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      if (e instanceof AuthRequiredError) {
        // token 누락은 RFC 6750 §3 권고 — error code 없이 challenge만.
        res.setHeader(
          'WWW-Authenticate',
          buildWwwAuthenticate(options.canonicalUri, metadataUrl),
        )
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      next(e)
      return
    }
    ;(req as AuthedRequest).auth = {
      token: 'verified', // placeholder — 실제 access token은 SDK 콘텍스트로 propagate 안 함 (CLAUDE.md §3)
      clientId: auth.clientId ?? 'mcp',
      scopes: [...auth.scopes],
      extra: { userId: auth.userId },
    }
    next()
  }
}
