import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { NotFoundError } from '../../src/openapi/errors.js'

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

const { revertDoneTodo } = await import('../../src/tools/doneTodoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    todo: { uuid: 't-1', userId: 'u-1', name: 'task', is_current: true, create_timestamp: 1 },
    detail: null,
  }
})

describe('revert_done_todo — happy path', () => {
  it('POST /v2/open/todos/dones/{id}/revert — body 없음', async () => {
    await revertDoneTodo.execute(auth, { done_todo_id: 'done-1' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/done-1/revert')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('done_todo_id URL 인코딩', async () => {
    await revertDoneTodo.execute(auth, { done_todo_id: 'done/with space' })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/done%2Fwith%20space/revert')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (todo.create_timestamp_iso)', async () => {
    const raw = {
      todo: {
        uuid: 't-1',
        userId: 'u-1',
        name: 'task',
        is_current: false,
        create_timestamp: 1_700_000_000,
        event_time: { time_type: 'at', timestamp: 1_700_003_600 },
      },
      detail: { place: 'home', url: null, memo: 'restored' },
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await revertDoneTodo.execute(auth, { done_todo_id: 'done-1' })
    const r = result as Record<string, unknown>
    const todo = r.todo as Record<string, unknown>

    // raw 보존
    expect(r).toMatchObject({ detail: raw.detail, extra_unknown_field: 'kept' })
    expect(todo).toMatchObject(raw.todo)
    // create_timestamp_iso 추가
    expect(todo.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    // event_time.timestamp_iso 추가
    const et = todo.event_time as Record<string, unknown>
    expect(et.timestamp).toBe(1_700_003_600)
    expect(et.timestamp_iso).toBe('2023-11-14T23:13:20.000Z')
  })

  it('detail null인 응답도 통과 (nullable)', async () => {
    const raw = {
      todo: { uuid: 't-1', userId: 'u-1', name: 'task', is_current: true, create_timestamp: 1 },
      detail: null,
    }
    openApiSpy.responsePayload = raw

    const result = await revertDoneTodo.execute(auth, { done_todo_id: 'done-1' })

    expect(result).toMatchObject(raw)
  })
})

describe('revert_done_todo — input validation', () => {
  it('done_todo_id 빈 문자열 — zod throw', async () => {
    await expect(revertDoneTodo.execute(auth, { done_todo_id: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('done_todo_id 누락 — zod throw', async () => {
    await expect(revertDoneTodo.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth 안전', async () => {
    await revertDoneTodo.execute(auth, { done_todo_id: 'done-1', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toBeUndefined()
  })
})

describe('revert_done_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('done todo missing')

    await expect(revertDoneTodo.execute(auth, { done_todo_id: 'missing' })).rejects.toThrow(
      /The requested resource does not exist\. \(done todo missing\)/,
    )
  })
})

describe('revert_done_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(revertDoneTodo.name).toBe('revert_done_todo')
    expect(typeof revertDoneTodo.description).toBe('string')
    expect(revertDoneTodo.description.length).toBeGreaterThan(0)
    expect(revertDoneTodo.inputSchema).toBeDefined()
    expect(revertDoneTodo.outputSchema).toBeDefined()
  })
})
