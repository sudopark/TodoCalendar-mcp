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

const auth: Auth = { userId: 'u-1' }

const newSchedule = {
  name: 'branched',
  event_time: { time_type: 'at' as const, timestamp: 1_700_010_000 },
  repeating: {
    start: 1_700_010_000,
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
  it('POST /v2/open/schedules/{id}/branch_repeating + body {new, end_time}', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-origin',
      new: newSchedule,
      end_time: 1_700_003_600,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-origin/branch_repeating')
    expect(openApiSpy.lastBody).toEqual({
      new: newSchedule,
      end_time: 1_700_003_600,
    })
  })

  it('schedule_id URL 인코딩', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's/with space',
      new: newSchedule,
      end_time: 1_700_003_600,
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space/branch_repeating')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      origin: {
        uuid: 's-origin',
        userId: 'u-1',
        name: 'recurring',
        extra_unknown_field: 'kept',
      },
      new: {
        uuid: 's-branch',
        userId: 'u-1',
        name: 'branched',
      },
      extra_top_level: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-origin',
      new: newSchedule,
      end_time: 1_700_003_600,
    })

    expect(result).toEqual(raw)
  })
})

describe('branch_schedule_repeating — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: '',
        new: newSchedule,
        end_time: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('new 누락 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        end_time: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('end_time 누락 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, { schedule_id: 's-1', new: newSchedule }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('end_time 숫자가 아님 — zod throw', async () => {
    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        new: newSchedule,
        end_time: 'tomorrow',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — body·auth에 흘러가지 않음', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-1',
      new: newSchedule,
      end_time: 1_700_003_600,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({
      new: newSchedule,
      end_time: 1_700_003_600,
    })
  })

  it('nested userId(new 안) — zod strip으로 백엔드까지 안 흐름 (contract pin)', async () => {
    await branchScheduleRepeating.execute(auth, {
      schedule_id: 's-1',
      new: { ...newSchedule, userId: 'attacker' },
      end_time: 1_700_003_600,
    })

    expect(openApiSpy.lastBody).toEqual({
      new: newSchedule,
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
        new: newSchedule,
        end_time: 1_700_003_600,
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('end_time invalid')

    await expect(
      branchScheduleRepeating.execute(auth, {
        schedule_id: 's-1',
        new: newSchedule,
        end_time: 1_700_003_600,
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

  it('description은 Functions #178 알려진 이슈(현재 500)를 안내', () => {
    expect(branchScheduleRepeating.description).toMatch(/#178|known issue|currently returns 500/i)
  })
})
