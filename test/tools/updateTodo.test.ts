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

const { updateTodo } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 't-1',
    userId: 'u-1',
    name: 'renamed',
    is_current: false,
    create_timestamp: 1_700_000_000,
  }
})

describe('update_todo — happy path', () => {
  it('단일 필드(name) — PATCH /v2/open/todos/{id} + body {name}', async () => {
    await updateTodo.execute(auth, { todo_id: 't-1', name: 'renamed' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PATCH')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t-1')
    expect(openApiSpy.lastBody).toEqual({ name: 'renamed' })
  })

  it('event_time(at) + event_tag_id 동시 — body에 모두 포함', async () => {
    await updateTodo.execute(auth, {
      todo_id: 't-1',
      event_tag_id: 'tag-2',
      event_time: { time_type: 'at', timestamp: 1_700_003_600 },
    })

    expect(openApiSpy.lastBody).toEqual({
      event_tag_id: 'tag-2',
      event_time: { time_type: 'at', timestamp: 1_700_003_600 },
    })
  })

  it('repeating + notification_options — opaque 객체 통과', async () => {
    const repeating = {
      start: 1_700_000_000,
      option: { optionType: 'every_day', interval: 1 },
    }
    const notifs = [{ type: 'at_time' }]
    await updateTodo.execute(auth, {
      todo_id: 't-1',
      repeating,
      notification_options: notifs,
    })

    expect(openApiSpy.lastBody).toEqual({ repeating, notification_options: notifs })
  })

  it('todo_id URL 인코딩 — 슬래시·공백 escape', async () => {
    await updateTodo.execute(auth, { todo_id: 'evt/with space', name: 'x' })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/evt%2Fwith%20space')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 't-1',
      userId: 'u-1',
      name: 'renamed',
      is_current: false,
      create_timestamp: 1_700_000_000,
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await updateTodo.execute(auth, { todo_id: 't-1', name: 'renamed' })

    expect(result).toEqual(raw)
  })
})

describe('update_todo — input validation', () => {
  it('todo_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(updateTodo.execute(auth, { todo_id: '', name: 'x' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 알 수 없음 — zod throw', async () => {
    await expect(
      updateTodo.execute(auth, {
        todo_id: 't-1',
        event_time: { time_type: 'never', timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await updateTodo.execute(auth, { todo_id: 't-1', name: 'x', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x' })
  })
})

describe('update_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('todo missing')

    await expect(updateTodo.execute(auth, { todo_id: 'missing', name: 'x' })).rejects.toThrow(
      /The requested resource does not exist\. \(todo missing\)/,
    )
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(
      updateTodo.execute(auth, {
        todo_id: 't-1',
        event_time: { time_type: 'at', timestamp: 1 },
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_time invalid\)/)
  })
})

describe('update_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(updateTodo.name).toBe('update_todo')
    expect(typeof updateTodo.description).toBe('string')
    expect(updateTodo.description.length).toBeGreaterThan(0)
    expect(updateTodo.inputSchema).toBeDefined()
    expect(updateTodo.outputSchema).toBeDefined()
  })
})
