import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InvalidParameterError, NotFoundError } from '../../src/openapi/errors.js'

interface OpenApiCall {
  auth: Auth
  method: string
  path: string
  body: unknown
}

interface OpenApiSpy {
  calls: OpenApiCall[]
  responses: Record<string, unknown>
  errors: Record<string, Error>
}

const openApiSpy: OpenApiSpy = { calls: [], responses: {}, errors: {} }

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: async (auth: Auth, method: string, path: string, body?: unknown) => {
    openApiSpy.calls.push({ auth, method, path, body })
    const key = `${method} ${path}`
    const error = openApiSpy.errors[key]
    if (error) throw error
    return openApiSpy.responses[key]
  },
}))

const { setForemostEvent } = await import('../../src/tools/foremostEventTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

const PUT_FOREMOST = 'PUT /v2/open/foremost/event'

const lastPut = (): OpenApiCall | undefined =>
  openApiSpy.calls.filter((c) => c.method === 'PUT').at(-1)

const givenTodo = (id: string) => {
  openApiSpy.responses[`GET /v2/open/todos/${id}`] = { uuid: id }
}

const givenSchedule = (id: string) => {
  openApiSpy.errors[`GET /v2/open/todos/${id}`] = new NotFoundError('Todo not found')
  openApiSpy.responses[`GET /v2/open/schedules/${id}`] = { uuid: id }
}

const givenNeither = (id: string) => {
  openApiSpy.errors[`GET /v2/open/todos/${id}`] = new NotFoundError('Todo not found')
  openApiSpy.errors[`GET /v2/open/schedules/${id}`] = new NotFoundError('Schedule not found')
}

beforeEach(() => {
  openApiSpy.calls = []
  openApiSpy.errors = {}
  openApiSpy.responses = {
    [PUT_FOREMOST]: {
      event_id: 'evt-1',
      is_todo: true,
      event: { uuid: 'evt-1', userId: 'u-1', name: 'x', is_current: false, create_timestamp: 0 },
    },
  }
})

describe('set_foremost_event — kind detection', () => {
  it('todo id → is_todo=true로 PUT', async () => {
    givenTodo('t-1')

    await setForemostEvent.execute(auth, { event_id: 't-1' })

    const put = lastPut()
    expect(put?.auth).toBe(auth)
    expect(put?.path).toBe('/v2/open/foremost/event')
    expect(put?.body).toEqual({ event_id: 't-1', is_todo: true })
  })

  it('schedule id → is_todo=false로 PUT', async () => {
    givenSchedule('s-1')

    await setForemostEvent.execute(auth, { event_id: 's-1' })

    expect(lastPut()?.body).toEqual({ event_id: 's-1', is_todo: false })
  })

  it('호출자가 틀린 is_todo를 넘겨도 무시하고 판별값 사용', async () => {
    givenSchedule('s-1')

    await setForemostEvent.execute(auth, { event_id: 's-1', is_todo: true })

    expect(lastPut()?.body).toEqual({ event_id: 's-1', is_todo: false })
  })

  it('todo·schedule 둘 다 없음 → NotFound, PUT 안 함 (dangling pin 방지)', async () => {
    givenNeither('ghost')

    await expect(setForemostEvent.execute(auth, { event_id: 'ghost' })).rejects.toMatchObject({
      name: 'ToolError',
      status: 404,
      code: 'NotFound',
      message: expect.stringMatching(/no todo or schedule with event_id ghost/),
    })
    expect(lastPut()).toBeUndefined()
  })

  it('판별 조회가 NotFound 외 에러 → 그대로 전파, PUT 안 함', async () => {
    openApiSpy.errors['GET /v2/open/todos/t-1'] = new InvalidParameterError('bad id')

    await expect(setForemostEvent.execute(auth, { event_id: 't-1' })).rejects.toThrow(
      /The request parameters are invalid\. \(bad id\)/,
    )
    expect(lastPut()).toBeUndefined()
  })

  it('event_id는 path에 URL 인코딩', async () => {
    givenTodo('a%2Fb')

    await setForemostEvent.execute(auth, { event_id: 'a/b' })

    expect(openApiSpy.calls[0]?.path).toBe('/v2/open/todos/a%2Fb')
  })
})

describe('set_foremost_event — response', () => {
  it('embedded event(todo)의 create_timestamp / event_time에 *_iso 추가', async () => {
    givenTodo('t-1')
    openApiSpy.responses[PUT_FOREMOST] = {
      event_id: 't-1',
      is_todo: true,
      event: {
        uuid: 't-1',
        userId: 'u-1',
        name: 'x',
        is_current: false,
        create_timestamp: 1700000000,
        event_time: { time_type: 'at', timestamp: 1700001000 },
      },
    }

    const result = (await setForemostEvent.execute(auth, { event_id: 't-1' })) as Record<
      string,
      unknown
    >

    const event = result.event as Record<string, unknown>
    expect(event.create_timestamp).toBe(1700000000)
    expect(event.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    expect((event.event_time as Record<string, unknown>).timestamp_iso).toBe(
      '2023-11-14T22:30:00.000Z',
    )
  })

  it('raw passthrough — unknown 필드 보존', async () => {
    givenTodo('evt-1')
    openApiSpy.responses[PUT_FOREMOST] = {
      event_id: 'evt-1',
      is_todo: true,
      event: { uuid: 'evt-1', userId: 'u-1', name: 'x', is_current: false, create_timestamp: 0 },
      extra_unknown_field: 'kept',
    }

    const result = (await setForemostEvent.execute(auth, { event_id: 'evt-1' })) as Record<
      string,
      unknown
    >

    expect(result.extra_unknown_field).toBe('kept')
  })
})

describe('set_foremost_event — input validation', () => {
  it('event_id 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(setForemostEvent.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.calls).toHaveLength(0)
  })

  it('event_id 빈 문자열 — zod throw', async () => {
    await expect(setForemostEvent.execute(auth, { event_id: '' })).rejects.toThrow()
    expect(openApiSpy.calls).toHaveLength(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    givenTodo('evt-1')

    await setForemostEvent.execute(auth, { event_id: 'evt-1', userId: 'attacker' })

    expect(openApiSpy.calls.every((c) => c.auth === auth)).toBe(true)
    expect(lastPut()?.body).toEqual({ event_id: 'evt-1', is_todo: true })
  })
})

describe('set_foremost_event — error wrap', () => {
  it('PUT OpenApiError(NotFound) → ToolError', async () => {
    givenTodo('t-1')
    openApiSpy.errors[PUT_FOREMOST] = new NotFoundError('missing target')

    await expect(setForemostEvent.execute(auth, { event_id: 't-1' })).rejects.toThrow(
      /The requested resource does not exist\. \(missing target\)/,
    )
  })

  it('PUT OpenApiError(InvalidParameter) → ToolError', async () => {
    givenTodo('t-1')
    openApiSpy.errors[PUT_FOREMOST] = new InvalidParameterError('event_id missing')

    await expect(setForemostEvent.execute(auth, { event_id: 't-1' })).rejects.toThrow(
      /The request parameters are invalid\. \(event_id missing\)/,
    )
  })
})

describe('set_foremost_event — metadata', () => {
  it('name·description·scopes·schemas 노출', () => {
    expect(setForemostEvent.name).toBe('set_foremost_event')
    expect(typeof setForemostEvent.description).toBe('string')
    expect(setForemostEvent.description.length).toBeGreaterThan(0)
    expect(setForemostEvent.scopes).toEqual(['read:calendar', 'write:calendar'])
    expect(setForemostEvent.inputSchema).toBeDefined()
    expect(setForemostEvent.outputSchema).toBeDefined()
  })
})
