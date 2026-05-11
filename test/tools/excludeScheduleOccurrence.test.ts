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

const { excludeScheduleOccurrence } = await import('../../src/tools/scheduleTools.js')

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
    name: 'recurring',
    exclude_repeatings: [1_700_003_600],
  }
})

describe('exclude_schedule_occurrence — happy path', () => {
  it('PATCH /v2/open/schedules/{id}/exclude + body {exclude_repeatings}', async () => {
    await excludeScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      exclude_repeatings: 1_700_003_600,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PATCH')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-1/exclude')
    expect(openApiSpy.lastBody).toEqual({ exclude_repeatings: 1_700_003_600 })
  })

  it('schedule_id URL 인코딩', async () => {
    await excludeScheduleOccurrence.execute(auth, {
      schedule_id: 's/with space',
      exclude_repeatings: 1_700_003_600,
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space/exclude')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 's-1',
      userId: 'u-1',
      name: 'recurring',
      exclude_repeatings: [1_700_003_600, 1_700_090_000],
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await excludeScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      exclude_repeatings: 1_700_003_600,
    })

    expect(result).toEqual(raw)
  })
})

describe('exclude_schedule_occurrence — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(
      excludeScheduleOccurrence.execute(auth, {
        schedule_id: '',
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('exclude_repeatings 누락 — zod throw', async () => {
    await expect(
      excludeScheduleOccurrence.execute(auth, { schedule_id: 's-1' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('exclude_repeatings 숫자가 아님 — zod throw', async () => {
    await expect(
      excludeScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        exclude_repeatings: 'now',
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await excludeScheduleOccurrence.execute(auth, {
      schedule_id: 's-1',
      exclude_repeatings: 1_700_003_600,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ exclude_repeatings: 1_700_003_600 })
  })
})

describe('exclude_schedule_occurrence — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('schedule missing')

    await expect(
      excludeScheduleOccurrence.execute(auth, {
        schedule_id: 'missing',
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('not in repeating')

    await expect(
      excludeScheduleOccurrence.execute(auth, {
        schedule_id: 's-1',
        exclude_repeatings: 1_700_003_600,
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(not in repeating\)/)
  })
})

describe('exclude_schedule_occurrence — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(excludeScheduleOccurrence.name).toBe('exclude_schedule_occurrence')
    expect(typeof excludeScheduleOccurrence.description).toBe('string')
    expect(excludeScheduleOccurrence.description.length).toBeGreaterThan(0)
    expect(excludeScheduleOccurrence.inputSchema).toBeDefined()
    expect(excludeScheduleOccurrence.outputSchema).toBeDefined()
  })
})
