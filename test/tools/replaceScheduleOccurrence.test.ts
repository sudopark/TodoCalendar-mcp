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

const { replaceScheduleOccurrence } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1' }

const newSchedule = {
  name: 'one-off',
  event_time: { time_type: 'at' as const, timestamp: 1_700_010_000 },
}

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    updated_origin: {
      uuid: 's-1',
      userId: 'u-1',
      name: 'recurring',
      exclude_repeatings: [1_700_003_600],
    },
    new_schedule: {
      uuid: 's-new',
      userId: 'u-1',
      name: 'one-off',
    },
  }
})

describe('replace_schedule_occurrence — happy path', () => {
  it('POST /v2/open/schedules/{id}/exclude + body {new, exclude_repeatings}', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-1/exclude')
    expect(openApiSpy.lastBody).toEqual({
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
    })
  })

  it('schedule_id URL 인코딩', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's/with space',
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space/exclude')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      updated_origin: {
        uuid: 's-1',
        userId: 'u-1',
        name: 'recurring',
        exclude_repeatings: [1_700_003_600],
        extra_unknown_field: 'kept',
      },
      new_schedule: {
        uuid: 's-new',
        userId: 'u-1',
        name: 'one-off',
      },
      extra_top_level: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
    })

    expect(result).toEqual(raw)
  })
})

describe('replace_schedule_occurrence — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: '',
        new: newSchedule,
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new 누락 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new.event_time 누락 — zod throw (schedule은 event_time 필수)', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: { name: 'one-off' },
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('exclude_repeatings 누락 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: newSchedule,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — body·auth에 흘러가지 않음', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({
      new: newSchedule,
      exclude_repeatings: 1_700_003_600,
    })
  })
})

describe('replace_schedule_occurrence — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('schedule missing')

    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 'missing',
        new: newSchedule,
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('invalid time')

    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: newSchedule,
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(invalid time\)/)
  })
})

describe('replace_schedule_occurrence — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(replaceScheduleOccurrence.name).toBe('replace_schedule_occurrence')
    expect(typeof replaceScheduleOccurrence.description).toBe('string')
    expect(replaceScheduleOccurrence.description.length).toBeGreaterThan(0)
    expect(replaceScheduleOccurrence.inputSchema).toBeDefined()
    expect(replaceScheduleOccurrence.outputSchema).toBeDefined()
  })
})
