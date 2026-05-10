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

const { getSchedules } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = []
})

describe('get_schedules', () => {
  it('lower/upper 쿼리스트링으로 호출', async () => {
    await getSchedules.execute(auth, { lower: 1_700_000_000, upper: 1_700_086_400 })

    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/?lower=1700000000&upper=1700086400')
  })

  it('lower 누락 — zod throw', async () => {
    await expect(getSchedules.execute(auth, { upper: 1 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('upper 누락 — zod throw', async () => {
    await expect(getSchedules.execute(auth, { lower: 1 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('Tool 인자에 userId 변조 시도 — 무시', async () => {
    await getSchedules.execute(auth, { lower: 1, upper: 2, userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/?lower=1&upper=2')
  })

  it('raw 응답 통과 — userId·exclude_repeatings 보존', async () => {
    const raw = [
      {
        uuid: 's-1',
        userId: 'u-1',
        name: 'meeting',
        event_time: {
          time_type: 'period',
          period_start: 1_700_000_000,
          period_end: 1_700_003_600,
        },
        exclude_repeatings: [1_700_604_800],
      },
    ]
    openApiSpy.responsePayload = raw

    const result = await getSchedules.execute(auth, { lower: 0, upper: 9_999_999_999 })

    expect(result).toEqual(raw)
  })

  it('OpenApiError → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('range invalid')

    await expect(getSchedules.execute(auth, { lower: 2, upper: 1 })).rejects.toThrow(
      /The request parameters are invalid\. \(range invalid\)/,
    )
  })

  it('metadata', () => {
    expect(getSchedules.name).toBe('get_schedules')
    expect(getSchedules.description).toMatch(/Unix epoch seconds/)
  })
})
