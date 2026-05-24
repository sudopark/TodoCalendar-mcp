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

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

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
  it('lower/upper ISO → 쿼리스트링 ts로 호출', async () => {
    await getSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })

    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/?lower=1700000000&upper=1700086400')
  })

  it('lower 누락 — zod throw', async () => {
    await expect(
      getSchedules.execute(auth, { upper: '2023-11-14T22:13:20Z' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('upper 누락 — zod throw', async () => {
    await expect(
      getSchedules.execute(auth, { lower: '2023-11-14T22:13:20Z' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('Tool 인자에 userId 변조 시도 — 무시', async () => {
    await getSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-14T23:13:20Z',
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/?lower=1700000000&upper=1700003600')
  })

  it('raw ts 보존 + *_iso 형제 필드 추가 (userId·exclude_repeatings 보존)', async () => {
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

    const result = await getSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-24T00:00:00Z',
    })

    expect(result).toMatchObject(raw)
    const r0 = (result as Record<string, unknown>[])[0] as Record<string, unknown>
    const et = r0.event_time as Record<string, unknown>
    expect(et.period_start_iso).toBe('2023-11-14T22:13:20.000Z')
    expect(et.period_end_iso).toBe('2023-11-14T23:13:20.000Z')
    expect(r0.exclude_repeatings_iso).toEqual(['2023-11-21T22:13:20.000Z'])
  })

  it('OpenApiError → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('range invalid')

    await expect(
      getSchedules.execute(auth, {
        lower: '2023-11-14T23:13:20Z',
        upper: '2023-11-14T22:13:20Z',
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(range invalid\)/)
  })

  it('metadata', () => {
    expect(getSchedules.name).toBe('get_schedules')
    expect(getSchedules.description).toMatch(/Unix epoch seconds/)
  })
})
