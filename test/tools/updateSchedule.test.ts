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

const { updateSchedule } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 's-1',
    userId: 'u-1',
    name: 'renamed',
  }
})

describe('update_schedule — happy path', () => {
  it('단일 필드(name) — PATCH /v2/open/schedules/{id} + body {name}', async () => {
    await updateSchedule.execute(auth, { schedule_id: 's-1', name: 'renamed' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PATCH')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-1')
    expect(openApiSpy.lastBody).toEqual({ name: 'renamed' })
  })

  it('event_time(allday) — discriminated union 통과', async () => {
    await updateSchedule.execute(auth, {
      schedule_id: 's-1',
      event_time: {
        time_type: 'allday',
        period_start: 1_700_000_000,
        period_end: 1_700_086_400,
        seconds_from_gmt: 32_400,
      },
    })

    expect(openApiSpy.lastBody).toEqual({
      event_time: {
        time_type: 'allday',
        period_start: 1_700_000_000,
        period_end: 1_700_086_400,
        seconds_from_gmt: 32_400,
      },
    })
  })

  it('repeating + show_turns + notification_options + event_tag_id — 모두 body 포함', async () => {
    const repeating = {
      start: 1_700_000_000,
      option: { optionType: 'every_week', interval: 1, dayOfWeek: [2], timeZone: 'Asia/Seoul' },
    }
    const showTurns = { '1700003600': true }
    const notifs = [{ type: 'before', minutes: 10 }]
    await updateSchedule.execute(auth, {
      schedule_id: 's-1',
      event_tag_id: 'tag-1',
      repeating,
      notification_options: notifs,
      show_turns: showTurns,
    })

    expect(openApiSpy.lastBody).toEqual({
      event_tag_id: 'tag-1',
      repeating,
      notification_options: notifs,
      show_turns: showTurns,
    })
  })

  it('schedule_id URL 인코딩 — 슬래시·공백 escape', async () => {
    await updateSchedule.execute(auth, { schedule_id: 's/with space', name: 'x' })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 's-1',
      userId: 'u-1',
      name: 'renamed',
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await updateSchedule.execute(auth, { schedule_id: 's-1', name: 'renamed' })

    expect(result).toEqual(raw)
  })
})

describe('update_schedule — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(
      updateSchedule.execute(auth, { schedule_id: '', name: 'x' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 알 수 없음 — zod throw', async () => {
    await expect(
      updateSchedule.execute(auth, {
        schedule_id: 's-1',
        event_time: { time_type: 'never', timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await updateSchedule.execute(auth, {
      schedule_id: 's-1',
      name: 'x',
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x' })
  })
})

describe('update_schedule — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('schedule missing')

    await expect(
      updateSchedule.execute(auth, { schedule_id: 'missing', name: 'x' }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(
      updateSchedule.execute(auth, {
        schedule_id: 's-1',
        event_time: { time_type: 'at', timestamp: 1 },
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_time invalid\)/)
  })
})

describe('update_schedule — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(updateSchedule.name).toBe('update_schedule')
    expect(typeof updateSchedule.description).toBe('string')
    expect(updateSchedule.description.length).toBeGreaterThan(0)
    expect(updateSchedule.inputSchema).toBeDefined()
    expect(updateSchedule.outputSchema).toBeDefined()
  })
})
