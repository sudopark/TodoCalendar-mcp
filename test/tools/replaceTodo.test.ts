import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InvalidParameterError, NotFoundError } from '../../src/openapi/errors.js'

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

const { replaceTodo } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    new_todo: {
      uuid: 't-new',
      userId: 'u-1',
      name: 'new turn',
      is_current: false,
      create_timestamp: 1_700_000_000,
    },
  }
})

describe('replace_todo — happy path', () => {
  it('new만 — POST /v2/open/todos/{id}/replace + body {new}', async () => {
    const newTodo = { name: 'replacement' }
    await replaceTodo.execute(auth, { todo_id: 't-origin', new: newTodo })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t-origin/replace')
    expect(openApiSpy.lastBody).toEqual({ new: newTodo })
  })

  it('new + origin_next_event_time — ISO 입력 → ts body 모두 포함', async () => {
    await replaceTodo.execute(auth, {
      todo_id: 't-origin',
      new: {
        name: 'replacement',
        event_time: { time_type: 'at' as const, timestamp: '2023-11-14T23:13:20Z' },
      },
      origin_next_event_time: { time_type: 'at' as const, timestamp: '2023-11-15T22:13:20Z' },
    })

    expect(openApiSpy.lastBody).toEqual({
      new: {
        name: 'replacement',
        event_time: { time_type: 'at', timestamp: 1_700_003_600 },
      },
      origin_next_event_time: { time_type: 'at', timestamp: 1_700_086_400 },
    })
  })

  it('todo_id URL 인코딩', async () => {
    await replaceTodo.execute(auth, {
      todo_id: 't/with space',
      new: { name: 'x' },
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t%2Fwith%20space/replace')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (extra 필드 보존)', async () => {
    const raw = {
      new_todo: {
        uuid: 't-new',
        userId: 'u-1',
        name: 'replacement',
        is_current: false,
        create_timestamp: 1_700_000_000,
        extra_unknown_field: 'kept',
      },
      next_repeating: {
        uuid: 't-origin',
        userId: 'u-1',
        name: 'origin',
        is_current: false,
        create_timestamp: 1_700_000_000,
      },
      extra_top_level: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await replaceTodo.execute(auth, {
      todo_id: 't-origin',
      new: { name: 'replacement' },
    })

    expect(result).toMatchObject(raw)
    const newTodo = (result as Record<string, unknown>).new_todo as Record<string, unknown>
    expect(newTodo.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    const nextRep = (result as Record<string, unknown>).next_repeating as Record<string, unknown>
    expect(nextRep.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('replace_todo — input validation', () => {
  it('todo_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(
      replaceTodo.execute(auth, { todo_id: '', new: { name: 'x' } }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new 누락 — zod throw', async () => {
    await expect(replaceTodo.execute(auth, { todo_id: 't-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new.name 빈 문자열 — zod throw', async () => {
    await expect(
      replaceTodo.execute(auth, { todo_id: 't-1', new: { name: '' } }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — body·auth에 흘러가지 않음', async () => {
    await replaceTodo.execute(auth, {
      todo_id: 't-1',
      new: { name: 'x' },
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ new: { name: 'x' } })
  })

  it('nested userId(new 안) — zod strip으로 백엔드까지 안 흐름 (contract pin)', async () => {
    await replaceTodo.execute(auth, {
      todo_id: 't-1',
      new: { name: 'x', userId: 'attacker' },
    })

    expect(openApiSpy.lastBody).toEqual({ new: { name: 'x' } })
  })
})

describe('replace_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('origin todo missing')

    await expect(
      replaceTodo.execute(auth, { todo_id: 'missing', new: { name: 'x' } }),
    ).rejects.toThrow(/The requested resource does not exist\. \(origin todo missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(
      replaceTodo.execute(auth, { todo_id: 't-1', new: { name: 'x' } }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_time invalid\)/)
  })
})

describe('replace_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(replaceTodo.name).toBe('replace_todo')
    expect(typeof replaceTodo.description).toBe('string')
    expect(replaceTodo.description.length).toBeGreaterThan(0)
    expect(replaceTodo.inputSchema).toBeDefined()
    expect(replaceTodo.outputSchema).toBeDefined()
  })
})
