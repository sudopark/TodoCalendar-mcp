import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidParameterError } from '../../src/openapi/errors.js'

const callOpenApi = vi.fn()

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: (...args: unknown[]) => callOpenApi(...args),
}))

const { getSchedules } = await import('../../src/tools/scheduleTools.js')

const auth = { userId: 'u-1' }

beforeEach(() => {
  callOpenApi.mockReset()
})

describe('get_schedules', () => {
  it('lower/upper 쿼리스트링으로 호출', async () => {
    callOpenApi.mockResolvedValue([])
    await getSchedules.execute(auth, { lower: 1_700_000_000, upper: 1_700_086_400 })
    expect(callOpenApi).toHaveBeenCalledWith(
      auth,
      'GET',
      '/v2/open/schedules/?lower=1700000000&upper=1700086400',
    )
  })

  it('lower 누락 — zod throw', async () => {
    await expect(getSchedules.execute(auth, { upper: 1 })).rejects.toThrow()
  })

  it('upper 누락 — zod throw', async () => {
    await expect(getSchedules.execute(auth, { lower: 1 })).rejects.toThrow()
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
    callOpenApi.mockResolvedValue(raw)
    const result = await getSchedules.execute(auth, { lower: 0, upper: 9_999_999_999 })
    expect(result).toEqual(raw)
  })

  it('OpenApiError → ToolError', async () => {
    callOpenApi.mockRejectedValue(new InvalidParameterError('range invalid'))
    await expect(getSchedules.execute(auth, { lower: 2, upper: 1 })).rejects.toThrow(
      /The request parameters are invalid\. \(range invalid\)/,
    )
  })

  it('metadata', () => {
    expect(getSchedules.name).toBe('get_schedules')
    expect(getSchedules.description).toMatch(/Unix epoch seconds/)
  })
})
