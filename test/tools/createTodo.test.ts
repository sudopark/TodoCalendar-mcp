import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InvalidParameterError } from '../../src/openapi/errors.js'

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

const { createTodo } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 't-new',
    userId: 'u-1',
    name: 'meeting',
    is_current: false,
    create_timestamp: 1_700_000_000,
  }
})

describe('create_todo — happy path', () => {
  it('name 단독 — POST /v2/open/todos/ + body {name}', async () => {
    await createTodo.execute(auth, { name: 'inbox-task' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/')
    expect(openApiSpy.lastBody).toEqual({ name: 'inbox-task' })
  })

  it('event_time(at) — discriminated union 통과', async () => {
    await createTodo.execute(auth, {
      name: 'lunch',
      event_time: { time_type: 'at', timestamp: 1_700_003_600 },
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'lunch',
      event_time: { time_type: 'at', timestamp: 1_700_003_600 },
    })
  })

  it('event_time(period) + event_tag_id — 모두 body에 포함', async () => {
    await createTodo.execute(auth, {
      name: 'workshop',
      event_tag_id: 'tag-1',
      event_time: {
        time_type: 'period',
        period_start: 1_700_000_000,
        period_end: 1_700_003_600,
      },
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'workshop',
      event_tag_id: 'tag-1',
      event_time: {
        time_type: 'period',
        period_start: 1_700_000_000,
        period_end: 1_700_003_600,
      },
    })
  })

  it('repeating + notification_options — opaque 객체 통과', async () => {
    const repeating = {
      start: 1_700_000_000,
      option: { optionType: 'every_day', interval: 1 },
    }
    const notifs = [{ type: 'at_time' }]
    await createTodo.execute(auth, {
      name: 'daily-standup',
      repeating,
      notification_options: notifs,
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'daily-standup',
      repeating,
      notification_options: notifs,
    })
  })

  it('raw 응답 그대로 반환 (passthrough — userId 등 보존)', async () => {
    const raw = {
      uuid: 't-9',
      userId: 'u-1',
      name: 'preserved',
      is_current: true,
      create_timestamp: 1_700_000_000,
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await createTodo.execute(auth, { name: 'preserved' })

    expect(result).toEqual(raw)
  })
})

describe('create_todo — input validation', () => {
  it('name 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(createTodo.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('name 빈 문자열 — zod throw', async () => {
    await expect(createTodo.execute(auth, { name: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 누락 — zod throw', async () => {
    await expect(
      createTodo.execute(auth, {
        name: 'x',
        event_time: { timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 알 수 없음 — zod throw', async () => {
    await expect(
      createTodo.execute(auth, {
        name: 'x',
        event_time: { time_type: 'never', timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await createTodo.execute(auth, { name: 'x', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x' })
  })
})

describe('create_todo — error wrap', () => {
  it('OpenApiError → ToolError, 자연어 prefix 추가', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(createTodo.execute(auth, { name: 'x' })).rejects.toThrow(
      /The request parameters are invalid\. \(event_time invalid\)/,
    )
  })
})

describe('create_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(createTodo.name).toBe('create_todo')
    expect(typeof createTodo.description).toBe('string')
    expect(createTodo.description.length).toBeGreaterThan(0)
    expect(createTodo.inputSchema).toBeDefined()
    expect(createTodo.outputSchema).toBeDefined()
  })
})
