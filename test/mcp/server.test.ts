import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import {
  InsufficientScopeError,
  InvalidParameterError,
  NotFoundError,
} from '../../src/openapi/errors.js'

// 같은 OpenApiSpy 모양을 test/tools/*.test.ts와 공유. write tool 추가 시에도 동일 spy 재사용.
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

vi.mock('../../src/openapi/client.js', () => ({
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

const { createMcpServer } = await import('../../src/mcp/server.js')

const auth: Auth = { userId: 'u-test' }

interface WireOptions {
  /** true면 createMcpServer의 default resolveAuth 사용 (InMemoryTransport 환경 → AuthInvariantError 시뮬레이션) */
  useDefaultResolveAuth?: boolean
}

const wireServer = async (options: WireOptions = {}) => {
  const server = createMcpServer(
    options.useDefaultResolveAuth === true ? {} : { resolveAuth: () => auth },
  )
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { server, client }
}

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = []
})

describe('mcp server — tools/list', () => {
  it('등록된 tool 모두 노출', async () => {
    const { client } = await wireServer()

    const result = await client.listTools()

    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'create_schedule',
      'create_tag',
      'create_todo',
      'get_done_todos',
      'get_event_details',
      'get_schedules',
      'get_tags',
      'get_todos',
    ])
  })

  it('각 tool 항목 — inputSchema는 type:object', async () => {
    const { client } = await wireServer()

    const { tools } = await client.listTools()

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('array output 가진 tool은 outputSchema 없음 (get_tags 등)', async () => {
    const { client } = await wireServer()

    const { tools } = await client.listTools()
    const tags = tools.find((t) => t.name === 'get_tags')

    expect(tags?.outputSchema).toBeUndefined()
  })

  it('object output 가진 tool은 outputSchema 노출 (get_event_details)', async () => {
    const { client } = await wireServer()

    const { tools } = await client.listTools()
    const eventDetail = tools.find((t) => t.name === 'get_event_details')

    expect(eventDetail?.outputSchema).toBeDefined()
    expect(eventDetail?.outputSchema?.type).toBe('object')
  })
})

describe('mcp server — tools/call', () => {
  it('get_tags — 배열 응답, content text에 raw JSON, structuredContent 없음', async () => {
    const raw = [
      { uuid: 'tag-1', userId: 'u-test', name: 'work', color_hex: '#fff' },
      { uuid: 'tag-2', userId: 'u-test', name: 'personal', color_hex: null },
    ]
    openApiSpy.responsePayload = raw
    const { client } = await wireServer()

    const result = await client.callTool({ name: 'get_tags', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(raw) }])
    expect(openApiSpy.lastAuth).toEqual(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/all')
  })

  it('get_event_details — object 응답, structuredContent에 raw 그대로', async () => {
    const raw = {
      place: 'home',
      url: null,
      memo: 'remember the milk',
    }
    openApiSpy.responsePayload = raw
    const { client } = await wireServer()

    const result = await client.callTool({
      name: 'get_event_details',
      arguments: { event_id: 'evt-1', is_done: false },
    })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual(raw)
  })

  it('get_event_details — zod에 없는 extra 필드도 structuredContent에 통과 (raw passthrough 회귀)', async () => {
    // additionalProperties:false → {} relax가 깨지면 client SDK가 reject.
    // openAPI가 zod에 없는 redundant 필드 보내는 실 시나리오.
    const raw = {
      place: 'home',
      url: null,
      memo: 'remember the milk',
      userId: 'u-test',
      created_at: 1_700_000_000,
      extra_unknown_field: 'ok',
    }
    openApiSpy.responsePayload = raw
    const { client } = await wireServer()

    const result = await client.callTool({
      name: 'get_event_details',
      arguments: { event_id: 'evt-1', is_done: false },
    })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual(raw)
  })

  it('userId 변조 시도 — auth.userId가 그대로 전달, args의 userId는 무시', async () => {
    const { client } = await wireServer()

    await client.callTool({
      name: 'get_tags',
      arguments: { userId: 'attacker' },
    })

    expect(openApiSpy.lastAuth).toEqual(auth)
    expect(openApiSpy.lastAuth?.userId).toBe('u-test')
  })

  it('알 수 없는 tool — UnknownTool 코드 + _meta 보존', async () => {
    const { client } = await wireServer()

    const result = await client.callTool({ name: 'nope', arguments: {} })

    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ code: 'UnknownTool', status: 404 })
  })

  it('zod validation 실패 — isError + 메시지, openapi 미호출', async () => {
    const { client } = await wireServer()

    const result = await client.callTool({ name: 'get_todos', arguments: {} })

    expect(result.isError).toBe(true)
    expect(openApiSpy.callCount).toBe(0)
  })

  it('OpenApiError(InvalidParameter) → ToolError로 wrap, _meta에 code/status', async () => {
    openApiSpy.responseError = new InvalidParameterError('lower required')
    const { client } = await wireServer()

    const result = await client.callTool({
      name: 'get_todos',
      arguments: { mode: 'range', lower: 1, upper: 2 },
    })

    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ code: 'InvalidParameter', status: 400 })
  })

  it('OpenApiError(NotFound) → 404 + NotFound code 보존', async () => {
    openApiSpy.responseError = new NotFoundError('event not found')
    const { client } = await wireServer()

    const result = await client.callTool({
      name: 'get_event_details',
      arguments: { event_id: 'missing', is_done: false },
    })

    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ code: 'NotFound', status: 404 })
  })

  it('OpenApiError(InsufficientScope) → 403 + InsufficientScope code 보존', async () => {
    openApiSpy.responseError = new InsufficientScopeError('write:calendar required')
    const { client } = await wireServer()

    const result = await client.callTool({ name: 'get_tags', arguments: {} })

    expect(result.isError).toBe(true)
    expect(result._meta).toEqual({ code: 'InsufficientScope', status: 403 })
  })

  it('AuthInvariantError — middleware 누락 시 JSON-RPC 에러로 bubble (CallToolResult 아님)', async () => {
    // Default resolveAuth (resolveAuthFromExtra)는 InMemoryTransport 환경에서 authInfo가 없으면
    // AuthInvariantError throw. SDK가 받아 JSON-RPC error로 응답.
    const { client } = await wireServer({ useDefaultResolveAuth: true })

    await expect(client.callTool({ name: 'get_tags', arguments: {} })).rejects.toThrow(
      /auth context missing/,
    )
  })
})
