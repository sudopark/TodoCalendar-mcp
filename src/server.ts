import http, { type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
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
const MAX_BODY_BYTES = 1024 * 1024 // 1 MB — JSON-RPC body sanity cap

class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'
}

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

// RFC 7235 quoted-string — `"`와 `\` 모두 escape 필수. 정보 손실 없이 안전화.
const escapeQuotedString = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

interface Challenge {
  error: string
  description?: string
  scope?: string
}

const buildWwwAuthenticate = (
  canonicalUri: string | undefined,
  metadataUrl: string | undefined,
  challenge?: Challenge,
): string => {
  const parts: string[] = []
  if (canonicalUri !== undefined) parts.push(`realm="${escapeQuotedString(canonicalUri)}"`)
  if (metadataUrl !== undefined)
    parts.push(`resource_metadata="${escapeQuotedString(metadataUrl)}"`)
  if (challenge !== undefined) {
    parts.push(`error="${escapeQuotedString(challenge.error)}"`)
    if (challenge.description !== undefined) {
      parts.push(`error_description="${escapeQuotedString(challenge.description)}"`)
    }
    if (challenge.scope !== undefined) {
      parts.push(`scope="${escapeQuotedString(challenge.scope)}"`)
    }
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

// JSON-RPC body 사전 파싱 — transport에 parsedBody로 전달 + scope enforce 사전 검증용.
// MAX_BODY_BYTES 초과는 `BodyTooLargeError`로 별도 분류 (413 응답 매핑 위해).
// settled flag로 first-settle wins 명시 — destroy 후 추가 이벤트 dead-loop 차단.
const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > MAX_BODY_BYTES) {
        settled = true
        reject(new BodyTooLargeError('request body too large'))
        // req.destroy()는 안 함 — client가 보내고 있는 동안 socket을 끊으면
        // client side에서 응답 헤더를 받기 전에 socket close라 'fetch failed' 처리됨.
        // 응답이 client에 도달할 수 있게 stream은 자연 종료까지 두고 body만 chunks에 넣지 않음.
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf-8')
      if (text === '') {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', (e) => {
      if (settled) return
      settled = true
      reject(e)
    })
  })
}

// JSON-RPC body에서 tools/call 인 호출들의 필요 scope 집합을 모음.
// batch도 처리 (array body). 그 외 method(initialize, tools/list 등)는 scope 무관.
const requiredScopesFor = (body: unknown): readonly string[] => {
  if (body === null || typeof body !== 'object') return []
  const items = Array.isArray(body) ? body : [body]
  const acc = new Set<string>()
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { method?: unknown; params?: unknown }
    if (rec.method !== 'tools/call') continue
    const params = rec.params as { name?: unknown } | undefined
    const name = params?.name
    if (typeof name !== 'string') continue
    const tool = tools[name]
    if (tool === undefined) continue
    for (const s of tool.scopes) acc.add(s)
  }
  return [...acc]
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

  let auth: Awaited<ReturnType<AuthExtractor>>
  try {
    auth = await extractAuth(req.headers)
  } catch (e) {
    if (e instanceof OAuthTokenError) {
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticate(options.canonicalUri, metadataUrl, {
          error: 'invalid_token',
        }),
      )
      writeJson(res, 401, { error: 'unauthorized' })
      return
    }
    if (e instanceof AuthRequiredError) {
      // token 누락은 RFC 6750 §3 권고 — error code 없이 challenge만.
      res.setHeader(
        'WWW-Authenticate',
        buildWwwAuthenticate(options.canonicalUri, metadataUrl),
      )
      writeJson(res, 401, { error: 'unauthorized' })
      return
    }
    throw e
  }

  let parsedBody: unknown
  try {
    parsedBody = await readJsonBody(req)
  } catch (e) {
    // JSON-RPC 2.0 envelope으로 응답 — SDK가 직접 파싱했을 때와 contract 통일.
    if (e instanceof BodyTooLargeError) {
      writeJson(res, 413, {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'request body too large' },
        id: null,
      })
      return
    }
    writeJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: invalid JSON' },
      id: null,
    })
    return
  }

  // RFC 6750 §3.1 scope enforce — transport 단계에서 403 + WWW-Authenticate.
  // LLM client가 표준 흐름으로 scope 재인가 진행 가능.
  const required = requiredScopesFor(parsedBody)
  const missing = required.filter((s) => !auth.scopes.includes(s))
  if (missing.length > 0) {
    const scopeStr = missing.join(' ')
    res.setHeader(
      'WWW-Authenticate',
      buildWwwAuthenticate(options.canonicalUri, metadataUrl, {
        error: 'insufficient_scope',
        description: 'token lacks required scope',
        scope: scopeStr,
      }),
    )
    writeJson(res, 403, { error: 'insufficient_scope' })
    return
  }

  req.auth = {
    token: 'verified', // placeholder — 실제 access token은 SDK 콘텍스트로 propagate 안 함 (CLAUDE.md §3)
    clientId: auth.clientId ?? 'mcp',
    scopes: [...auth.scopes],
    extra: { userId: auth.userId },
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
  await transport.handleRequest(req, res, parsedBody)
}

const writeProtectedResourceMetadata = (
  res: ServerResponse,
  options: HttpServerOptions,
): void => {
  if (options.canonicalUri === undefined || options.issuer === undefined) {
    // config-incomplete — endpoint 자체는 존재하므로 NotFound가 아닌 ServiceUnavailable로.
    writeJson(res, 503, { error: 'service_unavailable', message: 'auth metadata not configured' })
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
