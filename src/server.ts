import http, { type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import 'dotenv/config'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { OAuthTokenError } from './auth/oauthVerify.js'
import {
  type AuthExtractor,
  AuthRequiredError,
  extractDevAuth,
  extractOAuthAuth,
} from './middleware/auth.js'
import { createMcpServer } from './mcp/server.js'
import { tools } from './tools/index.js'

type AuthedRequest = IncomingMessage & { auth?: AuthInfo }

export type AuthMode = 'oauth' | 'dev'

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

// distinct scope set across the registry — RFC 9728 `scopes_supported`.
// Derived once at module load (tools is frozen).
const SUPPORTED_SCOPES: readonly string[] = [
  ...new Set(Object.values(tools).flatMap((t) => t.scopes)),
].sort()

const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

const writeMethodNotAllowed = (res: ServerResponse, allow: string): void => {
  res.statusCode = 405
  res.setHeader('content-type', 'application/json')
  res.setHeader('allow', allow)
  res.end(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }),
  )
}

const parsePathname = (req: IncomingMessage): string => {
  const raw = req.url ?? '/'
  const idx = raw.indexOf('?')
  return idx >= 0 ? raw.slice(0, idx) : raw
}

export const parseAllowedHosts = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined || raw.trim() === '') return undefined
  const list = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  return list.length > 0 ? list : undefined
}

export const resolveAuthMode = (raw: string | undefined): AuthMode =>
  raw === 'dev' ? 'dev' : 'oauth'

export interface HttpServerOptions {
  /**
   * DNS rebinding 보호용 호스트 화이트리스트. undefined면 protection 비활성 (로컬 dev 기본).
   * 운영 배포 시 Cloud Run 호스트명을 반드시 주입.
   */
  allowedHosts?: string[]
  /** auth pipeline 선택. dev → X-Dev-User-Id stub. oauth → Bearer + RS256 verify (env로 결정). */
  authMode?: AuthMode
  /** token `aud` 비교에 사용하는 본 server canonical URI + RFC 9728 `resource`. */
  canonicalUri?: string
  /** AS root URL — RFC 9728 `authorization_servers` 항목. */
  issuer?: string
}

// dev mode은 sync extractDevAuth를 promise로 감싸 동일 인터페이스로 통일.
const selectExtractor = (mode: AuthMode): AuthExtractor =>
  mode === 'dev' ? async (headers) => extractDevAuth(headers) : extractOAuthAuth

// RFC 6750 §3.1 challenge. error/error_description 없는 형태는 단순 401 (token 누락 시 표준).
const buildWwwAuthenticate = (
  canonicalUri: string | undefined,
  metadataUrl: string | undefined,
  challenge?: { error: string; description: string },
): string => {
  const parts: string[] = []
  if (canonicalUri !== undefined) parts.push(`realm="${canonicalUri}"`)
  if (metadataUrl !== undefined) parts.push(`resource_metadata="${metadataUrl}"`)
  if (challenge !== undefined) {
    parts.push(`error="${challenge.error}"`)
    parts.push(`error_description="${challenge.description.replace(/"/g, '')}"`)
  }
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer'
}

const metadataUrlFrom = (canonicalUri: string | undefined): string | undefined => {
  if (canonicalUri === undefined) return undefined
  try {
    const url = new URL(canonicalUri)
    return `${url.protocol}//${url.host}${PROTECTED_RESOURCE_METADATA_PATH}`
  } catch {
    return undefined
  }
}

// Stateless: spec/SDK가 권장하는 production 패턴 (SEP-1442 방향).
// 매 POST 요청에 fresh Server+Transport를 만들고 res close 시 정리.
// 세션 메모리 0, scale-out·serverless 친화적, session affinity 불필요.
const handleMcpPost = async (
  req: AuthedRequest,
  res: ServerResponse,
  options: HttpServerOptions,
  extractAuth: AuthExtractor,
): Promise<void> => {
  const metadataUrl = metadataUrlFrom(options.canonicalUri)
  try {
    const auth = await extractAuth(req.headers)
    req.auth = {
      token: 'dev', // SDK requires non-empty; verified upstream via extractor
      clientId: 'mcp',
      scopes: [...auth.scopes],
      extra: { userId: auth.userId, scopes: auth.scopes },
    }
  } catch (e) {
    if (e instanceof OAuthTokenError) {
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticate(options.canonicalUri, metadataUrl, {
          error: 'invalid_token',
          description: `${e.reason}: ${e.message}`,
        }),
      )
      writeJson(res, 401, {
        error: 'unauthorized',
        reason: e.reason,
        message: e.message,
      })
      return
    }
    if (e instanceof AuthRequiredError) {
      // token 누락은 RFC 6750 §3 권고 — error code 없이 challenge만.
      // 형식 오류(non-Bearer 등)는 invalid_request로 분류 — 본 ticket은 단순화 위해
      // AuthRequiredError 전부 token-absent로 처리 (LLM 클라가 발견 흐름 동일).
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticate(options.canonicalUri, metadataUrl),
      )
      writeJson(res, 401, { error: 'unauthorized', message: e.message })
      return
    }
    throw e
  }

  const mcpServer = createMcpServer()
  // DNS rebinding 보호: SDK 기본은 모두 비활성. allowedHosts 주입 시 protection 활성.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: options.allowedHosts !== undefined,
    allowedHosts: options.allowedHosts,
  })
  // res.on('close')는 정상 종료·클라이언트 disconnect 둘 다 발화. 어느 쪽이든 동일 cleanup.
  // close()는 throw할 일이 거의 없지만 unhandled rejection 방지 차원에서 swallow.
  res.on('close', () => {
    transport.close().catch(() => {})
    mcpServer.close().catch(() => {})
  })
  await mcpServer.connect(transport)
  await transport.handleRequest(req, res)
}

const writeProtectedResourceMetadata = (
  res: ServerResponse,
  options: HttpServerOptions,
): void => {
  if (options.canonicalUri === undefined || options.issuer === undefined) {
    writeJson(res, 404, { error: 'not_found' })
    return
  }
  writeJson(res, 200, {
    resource: options.canonicalUri,
    authorization_servers: [options.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [...SUPPORTED_SCOPES],
  })
}

export const createHttpServer = (options: HttpServerOptions = {}): HttpServer => {
  const mode = options.authMode ?? 'oauth'
  const extractAuth = selectExtractor(mode)
  return http.createServer((req, res) => {
    const pathname = parsePathname(req)

    if (req.method === 'GET' && pathname === '/health') {
      writeJson(res, 200, { status: 'ok' })
      return
    }
    if (req.method === 'GET' && pathname === PROTECTED_RESOURCE_METADATA_PATH) {
      writeProtectedResourceMetadata(res, options)
      return
    }
    if (pathname === '/mcp' || pathname === '/mcp/') {
      // Stateless 모드: GET(SSE)·DELETE(세션 종료)는 의미 없음. POST만 허용.
      if (req.method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      void handleMcpPost(req as AuthedRequest, res, options, extractAuth).catch((e: unknown) => {
        if (!res.headersSent) {
          const message = e instanceof Error ? e.message : String(e)
          writeJson(res, 500, { error: 'internal_error', message })
        }
      })
      return
    }
    writeJson(res, 404, { error: 'not_found' })
  })
}

const start = async (): Promise<void> => {
  const port = Number(process.env['PORT'] ?? 3000)
  const allowedHosts = parseAllowedHosts(process.env['ALLOWED_HOSTS'])
  const authMode = resolveAuthMode(process.env['AUTH_MODE'])
  const canonicalUri = process.env['MCP_CANONICAL_URI']
  const issuer = process.env['MCP_OAUTH_ISSUER']

  if (authMode === 'dev') {
    console.warn(
      '[warn] AUTH_MODE=dev — X-Dev-User-Id stub auth is for local development only. Do not deploy publicly.',
    )
  } else {
    if (canonicalUri === undefined || canonicalUri === '') {
      console.warn(
        '[warn] AUTH_MODE=oauth but MCP_CANONICAL_URI unset — token `aud` validation will fail at first request',
      )
    }
    if (issuer === undefined || issuer === '') {
      console.warn(
        '[warn] AUTH_MODE=oauth but MCP_OAUTH_ISSUER unset — token `iss` validation + JWKS fetch will fail at first request',
      )
    }
  }
  if (process.env['NODE_ENV'] === 'production' && allowedHosts === undefined) {
    console.warn(
      '[warn] ALLOWED_HOSTS unset in production — DNS rebinding protection disabled',
    )
  }

  const httpServer = createHttpServer({ allowedHosts, authMode, canonicalUri, issuer })
  await new Promise<void>((resolve) => httpServer.listen(port, resolve))
  console.log(
    `TodoCalendar MCP listening on :${port} (POST /mcp, GET /health, GET ${PROTECTED_RESOURCE_METADATA_PATH}) — stateless, auth=${authMode}`,
  )

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal} — shutting down`)
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    )
  }
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((e: unknown) => {
      console.error('Shutdown error:', e)
      process.exit(1)
    })
  })
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((e: unknown) => {
      console.error('Shutdown error:', e)
      process.exit(1)
    })
  })
}

// `tsc` 빌드 결과(`dist/server.js`)나 `tsx watch src/server.ts`로 직접 실행될 때만 listen.
// `createHttpServer`만 import하는 테스트 케이스에서는 listen 부작용 회피.
if (import.meta.url === `file://${process.argv[1]}`) {
  void start()
}
