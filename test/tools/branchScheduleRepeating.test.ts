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

const { branchScheduleRepeating } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

const newScheduleIso = {
  name: 'branched',
  event_time: { time_type: 'at' as const, timestamp: '2023-11-14T22:13:20Z' },
  repeating: {
    start: '2023-11-14T22:13:20Z',
    option: { optionType: 'every_day', interval: 1 },
  },
}
const newScheduleTs = {
  name: 'branched',
  event_time: { time_type: 'at' as const, timestamp: 1_700_000_000 },
  repeating: {
    start: 1_700_000_000,
    option: { optionType: 'every_day', interval: 1 },
  },
}

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    origin: {
      uuid: 's-origin',
      userId: 'u-1',
      name: 'recurring',
    },
    new: {
      uuid: 's-branch',
      userId: 'u-1',
      name: 'branched',
    },
  }
})

describe('branch_schedule_repeating — happy path', () => {
  it('ISO 입력 → POST /v2/open/schedules/{id}/branch_repeating + body ts {new, end_time}', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-origin',
      new: newScheduleIso,
      end_time: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-origin/branch_repeating')
    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
      end_time: 1_700_003_600,
    })
  })

  it('schedule_id URL 인코딩', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's/with space',
      new: newScheduleIso,
      end_time: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space/branch_repeating')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (passthrough)', async () => {
    const raw = {
      origin: {
        uuid: 's-origin',
        userId: 'u-1',
        name: 'recurring',
        event_time: { time_type: 'at', timestamp: 1_700_000_000 },
        extra_unknown_field: 'kept',
      },
      new: {
        uuid: 's-branch',
        userId: 'u-1',
        name: 'branched',
        repeating: { start: 1_700_000_000, option: { optionType: 'every_day', interval: 1 } },
      },
      extra_top_level: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-origin',
      new: newScheduleIso,
      end_time: '2023-11-14T23:13:20Z',
    })

    expect(result).toMatchObject(raw)
    const r = result as Record<string, unknown>
    const origin = r.origin as Record<string, unknown>
    const et = origin.event_time as Record<string, unknown>
    expect(et.timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    const newBranch = r.new as Record<string, unknown>
    const rep = newBranch.repeating as Record<string, unknown>
    expect(rep.start_iso).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('branch_schedule_repeating — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: '',
        new: newScheduleIso,
        end_time: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new 누락 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        end_time: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('end_time 누락 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, { schedule_id: 's-1', new: newScheduleIso }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('end_time 잘못된 ISO — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        new: newScheduleIso,
        end_time: 'tomorrow',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — body·auth에 흘러가지 않음', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-1',
      new: newScheduleIso,
      end_time: '2023-11-14T23:13:20Z',
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
      end_time: 1_700_003_600,
    })
  })

  it('nested userId(new 안) — zod strip으로 백엔드까지 안 흐름 (contract pin)', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-1',
      new: { ...newScheduleIso, userId: 'attacker' },
      end_time: '2023-11-14T23:13:20Z',
    })

    expect(openApiSpy.lastBody).toEqual({
      new: newScheduleTs,
      end_time: 1_700_003_600,
    })
  })
})

describe('branch_schedule_repeating — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('schedule missing')

    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 'missing',
        new: newScheduleIso,
        end_time: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('end_time invalid')

    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        new: newScheduleIso,
        end_time: '2023-11-14T23:13:20Z',
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(end_time invalid\)/)
  })
})

describe('branch_schedule_repeating — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(branchScheduleRepeating.name).toBe('branch_schedule_repeating')
    expect(typeof branchScheduleRepeating.description).toBe('string')
    expect(branchScheduleRepeating.description.length).toBeGreaterThan(0)
    expect(branchScheduleRepeating.inputSchema).toBeDefined()
    expect(branchScheduleRepeating.outputSchema).toBeDefined()
  })
})
