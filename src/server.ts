import http, { type Server as HttpServer } from 'node:http'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import cors from 'cors'
import {
  type AuthExtractor,
  extractDevAuth,
  extractOAuthAuth,
  mcpAuth,
} from './middleware/auth.js'
import { scopeEnforce } from './middleware/scope.js'
import { PROTECTED_RESOURCE_METADATA_PATH } from './middleware/wwwAuthenticate.js'
import { mcpRequestHandler } from './mcp/handler.js'
import { tools } from './tools/index.js'
import { FAVICON_PNG_BYTES } from './assets/favicon.js'

export type AuthMode = 'oauth' | 'dev'

// distinct scope set across the registry — RFC 9728 `scopes_supported`.
// Derived once at module load (tools is frozen).
const SUPPORTED_SCOPES: readonly string[] = [
  ...new Set(Object.values(tools).flatMap((t) => t.scopes)),
].sort()

export const parseAllowedHosts = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined || raw.trim() === '') return undefined
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
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
  /** auth pipeline 선택. dev → X-Dev-User-Id stub. oauth → Bearer + RS256 verify. */
  authMode?: AuthMode
  /** token `aud` 비교에 사용하는 본 server canonical URI + RFC 9728 `resource`. */
  canonicalUri?: string
  /** AS root URL — RFC 9728 `authorization_servers` 항목. */
  issuer?: string
}

// dev mode은 sync extractDevAuth를 promise로 감싸 동일 인터페이스로 통일.
const selectExtractor = (mode: AuthMode): AuthExtractor =>
  mode === 'dev' ? async (headers) => extractDevAuth(headers) : extractOAuthAuth

const protectedResourceMetadata =
  (options: HttpServerOptions): RequestHandler =>
  (_req, res) => {
    if (options.canonicalUri === undefined || options.issuer === undefined) {
      // config-incomplete — endpoint 자체는 존재하므로 NotFound가 아닌 ServiceUnavailable로.
      res
        .status(503)
        .json({ error: 'service_unavailable', message: 'auth metadata not configured' })
      return
    }
    res.json({
      resource: options.canonicalUri,
      authorization_servers: [options.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: [...SUPPORTED_SCOPES],
    })
  }

const methodNotAllowed: RequestHandler = (_req, res) => {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    })
}

// express.json / 기타 미들웨어가 throw한 에러를 JSON-RPC envelope으로 매핑.
// SDK가 직접 파싱했을 때와 contract 통일.
const jsonRpcErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // 응답 헤더가 이미 나간 상태(streaming 도중 throw 등)에선 추가 응답 시도 불가 — silent swallow.
  // default handler에 위임하면 stack trace 로그 noise만 더해지므로 명시적으로 멈춘다.
  if (res.headersSent) return

  const e = err as { type?: string; status?: number; statusCode?: number }
  const status = e.status ?? e.statusCode
  if (e.type === 'entity.too.large' || status === 413) {
    res.status(413).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'request body too large' },
      id: null,
    })
    return
  }
  if (e.type === 'entity.parse.failed' || status === 400) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: invalid JSON' },
      id: null,
    })
    return
  }
  // 내부 정보(stack trace, env 키 이름, DB 에러 등) 외부 누출 방지 — err.message는 서버 로그로만,
  // 응답 body는 generic 코드만 노출. #62 보안 리뷰.
  console.error('[internal_error]', err)
  res.status(500).json({ error: 'internal_error' })
}

export const createHttpServer = (options: HttpServerOptions = {}): HttpServer => {
  const mode = options.authMode ?? 'oauth'
  const extractor = selectExtractor(mode)

  const app = express()

  // 브라우저 기반 client(MCP Inspector 등)가 RS metadata·token endpoint를 fetch할 수 있도록
  // 모든 응답에 CORS 헤더. RS는 Bearer 인증이라 cookie credentials 없음 → `*` 안전.
  // Expose-Headers: WWW-Authenticate(OAuth challenge) + Mcp-Session-Id(transport spec).
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Mcp-Session-Id',
        'MCP-Protocol-Version',
        'X-Dev-User-Id',
      ],
      exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
      maxAge: 86400,
    }),
  )

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const sendFavicon: RequestHandler = (_req, res) => {
    res
      .status(200)
      .set('content-type', 'image/png')
      .set('cache-control', 'public, max-age=86400')
      .end(FAVICON_PNG_BYTES)
  }
  app.get('/favicon.ico', sendFavicon)
  app.get('/favicon.png', sendFavicon)

  app.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadata(options))

  // POST /mcp 파이프라인 — body parse → auth → scope → MCP handler.
  // 각 미들웨어는 단일 책임이며 실패 시 res 응답으로 종료, 성공 시 next().
  app.post(
    '/mcp',
    express.json({ limit: '1mb' }),
    mcpAuth({ extractor, canonicalUri: options.canonicalUri }),
    scopeEnforce({ canonicalUri: options.canonicalUri }),
    mcpRequestHandler({ allowedHosts: options.allowedHosts }),
  )
  // Stateless 모드: GET(SSE)·DELETE(세션 종료)는 의미 없음. POST만 허용.
  app.all('/mcp', methodNotAllowed)

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use(jsonRpcErrorHandler)

  return http.createServer(app)
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
    // OAuth 모드 — env 누락이면 첫 요청에서 throw 되는데 그 전에 readiness gate에서 잡히도록 fail-fast.
    const missing: string[] = []
    if (canonicalUri === undefined || canonicalUri === '') missing.push('MCP_CANONICAL_URI')
    if (issuer === undefined || issuer === '') missing.push('MCP_OAUTH_ISSUER')
    if (missing.length > 0) {
      console.error(
        `[fatal] AUTH_MODE=oauth requires ${missing.join(', ')} — refusing to start without auth env configured`,
      )
      process.exit(1)
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
    `TodoCalendar MCP listening on :${port} (POST /mcp, GET /health, GET ${PROTECTED_RESOURCE_METADATA_PATH}, GET /favicon.{ico,png}) — stateless, auth=${authMode}`,
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
