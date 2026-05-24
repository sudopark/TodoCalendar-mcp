import type { AddressInfo } from 'node:net'
import type { Server as HttpServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthTokenError } from '../src/auth/oauthVerify.js'
import type { Auth } from '../src/auth/types.js'

const verifyOAuthTokenMock = vi.fn()

vi.mock('../src/auth/oauthVerify.js', async () => {
  const actual = await vi.importActual<typeof import('../src/auth/oauthVerify.js')>(
    '../src/auth/oauthVerify.js',
  )
  return {
    ...actual,
    verifyOAuthToken: (...args: unknown[]) => verifyOAuthTokenMock(...args),
  }
})

// HTTP 진입점·라우팅·auth 게이트 회귀 잡기. listen은 ephemeral port + native fetch.
// MCP 핸들러 자체 로직은 test/mcp/server.test.ts(InMemoryTransport)에서 별도 검증.

interface OpenApiSpy {
  lastAuth: Auth | null
  lastMethod: string | null
  lastPath: string | null
  lastBody: unknown
  callCount: number
  responsePayload: unknown
  responseError: Error | null
}

const openApiSpy: OpenApiSpy = {
  lastAuth: null,
  lastMethod: null,
  lastPath: null,
  lastBody: undefined,
  callCount: 0,
  responsePayload: null,
  responseError: null,
}

vi.mock('../src/openapi/client.js', () => ({
  callOpenApi: async (auth: Auth, method: string, path: string, body?: unknown) => {
    openApiSpy.lastAuth = auth
    openApiSpy.lastMethod = method
    openApiSpy.lastPath = path
    openApiSpy.lastBody = body
    openApiSpy.callCount++
    if (openApiSpy.responseError) throw openApiSpy.responseError
    return openApiSpy.responsePayload
  },
}))

const { createHttpServer, parseAllowedHosts, resolveAuthMode } = await import('../src/server.js')

describe('resolveAuthMode', () => {
  it('AUTH_MODE=dev → dev', () => {
    expect(resolveAuthMode('dev')).toBe('dev')
  })

  it('AUTH_MODE=oauth → oauth', () => {
    expect(resolveAuthMode('oauth')).toBe('oauth')
  })

  it('AUTH_MODE 미설정 → oauth (안전한 default)', () => {
    expect(resolveAuthMode(undefined)).toBe('oauth')
  })

  it('알 수 없는 값 → oauth (안전한 default)', () => {
    expect(resolveAuthMode('whatever')).toBe('oauth')
  })
})

describe('parseAllowedHosts', () => {
  it('undefined → undefined (protection 비활성)', () => {
    expect(parseAllowedHosts(undefined)).toBeUndefined()
  })

  it('빈 문자열 → undefined', () => {
    expect(parseAllowedHosts('')).toBeUndefined()
    expect(parseAllowedHosts('   ')).toBeUndefined()
  })

  it('단일 호스트', () => {
    expect(parseAllowedHosts('foo.run.app')).toEqual(['foo.run.app'])
  })

  it('콤마 구분 + trim + 빈 항목 제거', () => {
    expect(parseAllowedHosts('foo.run.app, bar.run.app , ')).toEqual([
      'foo.run.app',
      'bar.run.app',
    ])
  })

  it('전부 빈 항목 → undefined', () => {
    expect(parseAllowedHosts(',,  ,')).toBeUndefined()
  })
})

let httpServer: HttpServer
let baseUrl: string

beforeAll(async () => {
  httpServer = createHttpServer({
    authMode: 'dev',
    canonicalUri: 'http://localhost:3000/mcp',
    issuer: 'https://api.todocalendar.example',
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const addr = httpServer.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    httpServer.close((err) => (err ? reject(err) : resolve())),
  )
})

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = []
  verifyOAuthTokenMock.mockReset()
})


describe('GET /health', () => {
  it('200 + {status:"ok"}', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})

describe('routing — unknown paths / methods', () => {
  it('GET /random — 404', async () => {
    const res = await fetch(`${baseUrl}/random`)
    expect(res.status).toBe(404)
  })

  it('GET /mcp — 405 + Allow: POST', async () => {
    const res = await fetch(`${baseUrl}/mcp`)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    const body = (await res.json()) as { jsonrpc: string; error: { message: string } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.message).toMatch(/Method not allowed/)
  })

  it('DELETE /mcp — 405 + Allow: POST', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('POST /mcp/ (trailing slash) — auth 게이트는 통과 (404 아님)', async () => {
    const res = await fetch(`${baseUrl}/mcp/`, { method: 'POST' })
    expect(res.status).toBe(401) // auth 게이트로 진입 = 라우팅 OK
  })
})

describe('auth gate', () => {
  it('POST /mcp without X-Dev-User-Id — 401 + 메시지', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unauthorized')
    // body는 generic — 진단 정보(reason/message)는 로그로만 (token probe 신호 차단)
    expect((body as Record<string, unknown>).reason).toBeUndefined()
    expect((body as Record<string, unknown>).message).toBeUndefined()
  })

  it('POST /mcp with empty X-Dev-User-Id — 401 (빈 문자열도 reject)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dev-user-id': '',
      },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /.well-known/oauth-protected-resource (RFC 9728)', () => {
  it('canonicalUri+issuer 주입된 dev server — 200 + 정확한 형식', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['https://api.todocalendar.example'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read:calendar', 'write:calendar'],
    })
  })

  it('env 없는 server — 503 (config incomplete, NotFound 아님)', async () => {
    const stripped = createHttpServer({ authMode: 'dev' })
    await new Promise<void>((r) => stripped.listen(0, '127.0.0.1', r))
    const addr = stripped.address() as AddressInfo
    const stripUrl = `http://127.0.0.1:${addr.port}`
    try {
      const res = await fetch(`${stripUrl}/.well-known/oauth-protected-resource`)
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('service_unavailable')
    } finally {
      await new Promise<void>((r, j) => stripped.close((e) => (e ? j(e) : r())))
    }
  })
})

describe('OAuth mode — 401 + WWW-Authenticate (RFC 6750 §3.1 / RFC 9728 §5.1)', () => {
  let oauthServer: HttpServer
  let oauthUrl: string

  beforeAll(async () => {
    oauthServer = createHttpServer({
      authMode: 'oauth',
      canonicalUri: 'http://localhost:3000/mcp',
      issuer: 'https://api.todocalendar.example',
    })
    await new Promise<void>((r) => oauthServer.listen(0, '127.0.0.1', r))
    const addr = oauthServer.address() as AddressInfo
    oauthUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((r, j) => oauthServer.close((e) => (e ? j(e) : r())))
  })

  it('Authorization 헤더 누락 — 401 + Bearer challenge (error 없음, RFC 6750 §3)', async () => {
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('www-authenticate') ?? ''
    expect(wwwAuth).toMatch(/^Bearer\b/)
    expect(wwwAuth).toMatch(/realm="http:\/\/localhost:3000\/mcp"/)
    expect(wwwAuth).toMatch(/resource_metadata="http:\/\/[^"]+\/.well-known\/oauth-protected-resource"/)
    expect(wwwAuth).not.toMatch(/error=/)
  })

  it('Bearer가 아닌 헤더 — 401 + challenge (Authorization Required)', async () => {
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic dXNlcjpwYXNz' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer\b/)
  })

  it('만료 token — 401 + invalid_token (reason은 body에 노출 안 함)', async () => {
    verifyOAuthTokenMock.mockRejectedValue(new OAuthTokenError('Expired', 'access token expired'))
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer dead.token.here' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('www-authenticate') ?? ''
    expect(wwwAuth).toMatch(/error="invalid_token"/)
    // reason discriminator는 외부 노출 안 함 — token probe 신호 차단
    expect(wwwAuth).not.toMatch(/Expired/)
    expect(wwwAuth).not.toMatch(/AudienceMismatch/)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('audience mismatch — 401 + invalid_token (구체 reason 미노출)', async () => {
    verifyOAuthTokenMock.mockRejectedValue(
      new OAuthTokenError('AudienceMismatch', 'audience mismatch'),
    )
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('www-authenticate') ?? ''
    expect(wwwAuth).toMatch(/error="invalid_token"/)
    expect(wwwAuth).not.toMatch(/AudienceMismatch/)
  })

  it('read-only token으로 write tool 호출 — 403 + insufficient_scope + WWW-Authenticate scope param', async () => {
    verifyOAuthTokenMock.mockResolvedValue({
      userId: 'u-test',
      scopes: ['read:calendar'],
    })
    const callBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_tag', arguments: { name: 'x', color_hex: '#fff' } },
    }
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer x.y.z',
      },
      body: JSON.stringify(callBody),
    })
    expect(res.status).toBe(403)
    const wwwAuth = res.headers.get('www-authenticate') ?? ''
    expect(wwwAuth).toMatch(/error="insufficient_scope"/)
    expect(wwwAuth).toMatch(/scope="write:calendar"/)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'insufficient_scope' })
  })

  it('write token으로 read tool — 403 (정확 일치 요구)', async () => {
    verifyOAuthTokenMock.mockResolvedValue({
      userId: 'u-test',
      scopes: ['write:calendar'],
    })
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer x.y.z',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_tags', arguments: {} },
      }),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate') ?? '').toMatch(/scope="read:calendar"/)
  })

  it('initialize / tools/list — scope 무관, 어떤 scope set이든 통과', async () => {
    verifyOAuthTokenMock.mockResolvedValue({ userId: 'u-1', scopes: [] })
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer x.y.z',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(200)
  })

  it('batch에 scope 부족 호출 하나만 있어도 전체 403', async () => {
    verifyOAuthTokenMock.mockResolvedValue({ userId: 'u-1', scopes: ['read:calendar'] })
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer x.y.z',
      },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_tags', arguments: {} } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_tag', arguments: { name: 'x', color_hex: '#fff' } } },
      ]),
    })
    expect(res.status).toBe(403)
  })

  it('invalid JSON body — 400 + JSON-RPC parse error envelope', async () => {
    verifyOAuthTokenMock.mockResolvedValue({ userId: 'u-1', scopes: ['read:calendar'] })
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      jsonrpc: string
      error: { code: number; message: string }
      id: unknown
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32700)
    expect(body.error.message).toMatch(/parse error/i)
    expect(body.id).toBeNull()
  })

  it('body too large (1MB 초과) — 413 + JSON-RPC envelope', async () => {
    verifyOAuthTokenMock.mockResolvedValue({ userId: 'u-1', scopes: ['read:calendar'] })
    // 1.1MB payload
    const big = 'x'.repeat(1024 * 1024 + 1024)
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: big } }),
    })
    expect(res.status).toBe(413)
    const body = (await res.json()) as {
      jsonrpc: string
      error: { code: number; message: string }
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toMatch(/too large/i)
  })

  it('extractor 일반 Error throw — 500 + body에 err.message 노출 없음 (#62 보안 리뷰)', async () => {
    // verifyOAuthToken이 OAuthTokenError가 아닌 일반 Error로 throw하면 mcpAuth가 next(e)로 위임,
    // jsonRpcErrorHandler fallback이 500을 응답한다. 이때 err.message가 body에 그대로 실리면
    // env 키 이름·JWKS URL·내부 stack 정보 등이 LLM client에 흘러갈 수 있어 generic 코드만 노출해야 함.
    verifyOAuthTokenMock.mockRejectedValue(new Error('internal: DB_URL=postgres://...'))
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
      body: '{}',
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'internal_error' })
    expect(body['message']).toBeUndefined()
  })

  it('정상 token — auth gate 통과 (initialize 200)', async () => {
    verifyOAuthTokenMock.mockResolvedValue({
      userId: 'oauth-user-1',
      scopes: ['read:calendar', 'write:calendar'],
    })
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    }
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer valid.token.here',
      },
      body: JSON.stringify(initBody),
    })
    expect(res.status).toBe(200)
    expect(verifyOAuthTokenMock).toHaveBeenCalledWith('valid.token.here')
  })
})

describe('end-to-end — POST /mcp + initialize handshake', () => {
  it('initialize 200 + serverInfo·protocolVersion 응답 (stateless fresh server)', async () => {
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    }
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-dev-user-id': 'u-test',
      },
      body: JSON.stringify(initBody),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    // SSE 응답 — `data: { ... }` 한 줄
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
    expect(dataLine).toBeDefined()
    const payload = JSON.parse(dataLine!.slice(6)) as {
      result: { protocolVersion: string; serverInfo: { name: string } }
    }
    expect(payload.result.protocolVersion).toBe('2025-06-18')
    expect(payload.result.serverInfo.name).toBe('todocalendar-mcp')
  })

  it('tools/list — fresh server에 init 없이 바로 보내도 등록된 tool 모두 응답 (stateless)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-dev-user-id': 'u-test',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
    const payload = JSON.parse(dataLine!.slice(6)) as { result: { tools: { name: string }[] } }
    expect(payload.result.tools.map((t) => t.name).sort()).toEqual([
      'branch_schedule_repeating',
      'complete_todo',
      'create_schedule',
      'create_tag',
      'create_todo',
      'delete_done_todo',
      'delete_event_detail',
      'delete_schedule',
      'delete_tag',
      'delete_todo',
      'exclude_schedule_occurrence',
      'get_done_todos',
      'get_event_details',
      'get_schedules',
      'get_tags',
      'get_todos',
      'replace_schedule_occurrence',
      'replace_todo',
      'revert_done_todo',
      'set_event_detail',
      'update_done_todo',
      'update_schedule',
      'update_tag',
      'update_todo',
    ])
  })
})
