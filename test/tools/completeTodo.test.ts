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

const { completeTodo } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

const originTodo = {
  uuid: 't-1',
  userId: 'u-1',
  name: 'task',
  is_current: false,
  create_timestamp: 1_700_000_000,
}

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    done: { uuid: 'done-1', userId: 'u-1', name: 'task' },
  }
})

describe('complete_todo — happy path', () => {
  // openAPI는 시간이 붙은 todo 응답에서 is_current를 아예 생략한다 (emulator 확인:
  // create_todo/get_todos 둘 다 누락). docs가 "get_todos 페이로드를 그대로 echo"라고
  // 안내하므로, is_current를 필수로 두면 시간 있는 todo의 완료가 전부 400으로 막힌다.
  it('origin에 is_current 없어도 — 그대로 openAPI로 전달', async () => {
    const { is_current, ...originWithoutIsCurrent } = originTodo
    void is_current

    await completeTodo.execute(auth, { todo_id: 't-1', origin: originWithoutIsCurrent })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastBody).toEqual({ origin: originWithoutIsCurrent })
  })

  // get_expanded_todos 의 docs 가 "stringify the turn and take the origin object from 'events'"
  // 라고 지시한다. 그 events 항목은 정규화돼 userId·create_timestamp 가 없고(expandedEventSchema),
  // openAPI 는 origin 이 truthy 하면 받는다 — 우리 게이트만 거부하면 문서대로 한 호출이 막힌다.
  it('origin이 expanded events 항목이어도 — 그대로 openAPI로 전달', async () => {
    const originFromEvents = {
      uuid: 't-1',
      name: 'daily standup',
      is_todo: true,
      event_tag_id: null,
      event_time: { time_type: 'at', timestamp: 1_800_000_000 },
      repeating: { start: 1_800_000_000, option: { optionType: 'every_day', interval: 1 } },
    }

    await completeTodo.execute(auth, { todo_id: 't-1', origin: originFromEvents })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastBody).toEqual({ origin: originFromEvents })
  })

  // origin 은 이전 응답을 되돌리는 echo 통로다 (CLAUDE.md §6). openAPI 가 새 필드를 돌려주면
  // 그 필드가 완료 스냅샷에 그대로 기록돼야 하는데, 게이트가 unknown 키를 strip 하면 조용히 사라진다.
  it('origin의 unknown 필드 — strip 하지 않고 그대로 전달', async () => {
    const originWithNewField = { ...originTodo, server_added_field: { a: 1 } }

    await completeTodo.execute(auth, { todo_id: 't-1', origin: originWithNewField })

    expect(openApiSpy.lastBody).toEqual({ origin: originWithNewField })
  })

  it('origin만 — POST /v2/open/todos/{id}/complete + body {origin}', async () => {
    await completeTodo.execute(auth, { todo_id: 't-1', origin: originTodo })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t-1/complete')
    expect(openApiSpy.lastBody).toEqual({ origin: originTodo })
  })

  it('반복 todo — origin + next_event_time + next_repeating_turn 모두 body 포함', async () => {
    await completeTodo.execute(auth, {
      todo_id: 't-1',
      origin: originTodo,
      next_event_time: { time_type: 'at' as const, timestamp: '2023-11-15T22:13:20Z' },
      next_repeating_turn: 'turn-2',
    })

    expect(openApiSpy.lastBody).toEqual({
      origin: originTodo,
      next_event_time: { time_type: 'at', timestamp: 1_700_086_400 },
      next_repeating_turn: 'turn-2',
    })
  })

  it('todo_id URL 인코딩', async () => {
    await completeTodo.execute(auth, {
      todo_id: 'todo/with space',
      origin: originTodo,
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/todo%2Fwith%20space/complete')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (next_repeating·done_detail·extra 보존)', async () => {
    const raw = {
      done: { uuid: 'done-1', userId: 'u-1', name: 'task', done_at: 1_700_000_000 },
      next_repeating: { uuid: 't-2', userId: 'u-1', name: 'task', create_timestamp: 1_700_000_000 },
      done_detail: { place: null, url: null, memo: 'note' },
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await completeTodo.execute(auth, { todo_id: 't-1', origin: originTodo })

    expect(result).toMatchObject({
      done: { uuid: 'done-1', userId: 'u-1', name: 'task', done_at: 1_700_000_000 },
      next_repeating: { uuid: 't-2', create_timestamp: 1_700_000_000 },
      done_detail: { place: null, url: null, memo: 'note' },
      extra_unknown_field: 'kept',
    })
    const done = (result as Record<string, unknown>).done as Record<string, unknown>
    expect(done.done_at_iso).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('complete_todo — input validation', () => {
  it('todo_id 빈 문자열 — zod throw', async () => {
    await expect(
      completeTodo.execute(auth, { todo_id: '', origin: originTodo }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('origin 누락 — zod throw (필수 필드)', async () => {
    await expect(completeTodo.execute(auth, { todo_id: 't-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('origin이 Todo 형태 아님 (uuid 없음) — zod throw', async () => {
    await expect(
      completeTodo.execute(auth, {
        todo_id: 't-1',
        origin: { userId: 'u-1', name: 'x', is_current: false, create_timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('top-level userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await completeTodo.execute(auth, {
      todo_id: 't-1',
      origin: originTodo,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ origin: originTodo })
  })

  it('origin.userId 변조 — swagger 필수 필드라 통과 (backend가 auth.sub로 덮어쓰는 defense에 의존)', async () => {
    const tampered = { ...originTodo, userId: 'attacker' }
    await completeTodo.execute(auth, { todo_id: 't-1', origin: tampered })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ origin: tampered })
  })
})

describe('complete_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('todo missing')

    await expect(
      completeTodo.execute(auth, { todo_id: 'missing', origin: originTodo }),
    ).rejects.toThrow(/The requested resource does not exist\. \(todo missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('next_event_time invalid')

    await expect(
      completeTodo.execute(auth, {
        todo_id: 't-1',
        origin: originTodo,
        next_event_time: { time_type: 'at', timestamp: '2023-11-14T22:13:20Z' },
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(next_event_time invalid\)/)
  })
})

describe('complete_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(completeTodo.name).toBe('complete_todo')
    expect(typeof completeTodo.description).toBe('string')
    expect(completeTodo.description.length).toBeGreaterThan(0)
    expect(completeTodo.inputSchema).toBeDefined()
    expect(completeTodo.outputSchema).toBeDefined()
  })
})
