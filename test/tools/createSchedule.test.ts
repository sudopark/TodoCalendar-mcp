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

const { createSchedule } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

const minimalEventTime = { time_type: 'at' as const, timestamp: 1_700_000_000 }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 's-new',
    userId: 'u-1',
    name: 'meeting',
  }
})

describe('create_schedule — happy path', () => {
  it('필수 필드만 — POST /v2/open/schedules/ + body {name, event_time}', async () => {
    await createSchedule.execute(auth, {
      name: 'standup',
      event_time: minimalEventTime,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/')
    expect(openApiSpy.lastBody).toEqual({
      name: 'standup',
      event_time: minimalEventTime,
    })
  })

  it('event_time(allday) — period_start·period_end·seconds_from_gmt 통과', async () => {
    await createSchedule.execute(auth, {
      name: 'workshop',
      event_time: {
        time_type: 'allday',
        period_start: 1_700_000_000,
        period_end: 1_700_086_400,
        seconds_from_gmt: 32_400,
      },
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'workshop',
      event_time: {
        time_type: 'allday',
        period_start: 1_700_000_000,
        period_end: 1_700_086_400,
        seconds_from_gmt: 32_400,
      },
    })
  })

  it('repeating·event_tag_id·notification_options·show_turns 모두 body에 포함', async () => {
    const repeating = {
      start: 1_700_000_000,
      option: { optionType: 'every_week', interval: 1, dayOfWeek: [2], timeZone: 'Asia/Seoul' },
    }
    const notifs = [{ type: 'before', minutes: 10 }]
    const showTurns = { '1700003600': true }
    await createSchedule.execute(auth, {
      name: 'weekly',
      event_time: minimalEventTime,
      event_tag_id: 'tag-1',
      repeating,
      notification_options: notifs,
      show_turns: showTurns,
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'weekly',
      event_time: minimalEventTime,
      event_tag_id: 'tag-1',
      repeating,
      notification_options: notifs,
      show_turns: showTurns,
    })
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 's-9',
      userId: 'u-1',
      name: 'preserved',
      event_time: minimalEventTime,
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await createSchedule.execute(auth, {
      name: 'preserved',
      event_time: minimalEventTime,
    })

    expect(result).toEqual(raw)
  })
})

describe('create_schedule — input validation', () => {
  it('name 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(
      createSchedule.execute(auth, { event_time: minimalEventTime }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time 누락 — zod throw (todo와 달리 schedule은 필수)', async () => {
    await expect(createSchedule.execute(auth, { name: 'x' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 누락 — zod throw', async () => {
    await expect(
      createSchedule.execute(auth, { name: 'x', event_time: { timestamp: 1 } }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await createSchedule.execute(auth, {
      name: 'x',
      event_time: minimalEventTime,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x', event_time: minimalEventTime })
  })
})

describe('create_schedule — error wrap', () => {
  it('OpenApiError → ToolError, 자연어 prefix 추가', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(
      createSchedule.execute(auth, { name: 'x', event_time: minimalEventTime }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_time invalid\)/)
  })
})

describe('create_schedule — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(createSchedule.name).toBe('create_schedule')
    expect(typeof createSchedule.description).toBe('string')
    expect(createSchedule.description.length).toBeGreaterThan(0)
    expect(createSchedule.inputSchema).toBeDefined()
    expect(createSchedule.outputSchema).toBeDefined()
  })
})
