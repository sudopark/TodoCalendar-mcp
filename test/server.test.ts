import type { AddressInfo } from 'node:net'
import type { Server as HttpServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../src/auth/types.js'

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

const { createHttpServer, parseAllowedHosts } = await import('../src/server.js')

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
  httpServer = createHttpServer()
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
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('unauthorized')
    expect(body.message).toMatch(/x-dev-user-id/i)
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
      'create_tag',
      'create_todo',
      'get_done_todos',
      'get_event_details',
      'get_schedules',
      'get_tags',
      'get_todos',
    ])
  })
})
