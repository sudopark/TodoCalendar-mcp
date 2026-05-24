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

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

const newScheduleIso = {
  name: 'one-off',
  event_time: { time_type: 'at' as const, timestamp: '2023-11-14T22:13:20Z' },
}
const newScheduleTs = {
  name: 'one-off',
  event_time: { time_type: 'at' as const, timestamp: 1_700_000_000 },
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
  it('ISO 입력 → POST /v2/open/schedules/{id}/exclude + body ts {new, exclude_repeatings}', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newScheduleIso,
      exclude_repeatings: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-1/exclude')
    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
      exclude_repeatings: 1_700_003_600,
    })
  })

  it('schedule_id URL 인코딩', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's/with space',
      new: newScheduleIso,
      exclude_repeatings: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space/exclude')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (passthrough)', async () => {
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
        event_time: { time_type: 'at', timestamp: 1_700_000_000 },
      },
      extra_top_level: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newScheduleIso,
      exclude_repeatings: '2023-11-14T23:13:20Z',
    })

    expect(result).toMatchObject(raw)
    const r = result as Record<string, unknown>
    const origin = r.updated_origin as Record<string, unknown>
    expect(origin.exclude_repeatings_iso).toEqual(['2023-11-14T23:13:20.000Z'])
    const newSched = r.new_schedule as Record<string, unknown>
    const et = newSched.event_time as Record<string, unknown>
    expect(et.timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('replace_schedule_occurrence — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: '',
        new: newScheduleIso,
        exclude_repeatings: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new 누락 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        exclude_repeatings: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new.event_time 누락 — zod throw (schedule은 event_time 필수)', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: { name: 'one-off' },
        exclude_repeatings: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('exclude_repeatings 누락 — zod throw', async () => {
    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: newScheduleIso,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — body·auth에 흘러가지 않음', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: newScheduleIso,
      exclude_repeatings: '2023-11-14T23:13:20Z',
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
      exclude_repeatings: 1_700_003_600,
    })
  })

  it('nested userId(new 안) — zod strip으로 백엔드까지 안 흐름 (contract pin)', async () => {
    await replaceScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      new: { ...newScheduleIso, userId: 'attacker' },
      exclude_repeatings: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
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
        new: newScheduleIso,
        exclude_repeatings: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('invalid time')

    await expect(
      replaceScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        new: newScheduleIso,
        exclude_repeatings: '2023-11-14T23:13:20Z',
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
