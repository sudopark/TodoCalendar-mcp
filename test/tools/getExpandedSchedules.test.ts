import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InvalidParameterError } from '../../src/openapi/errors.js'

interface OpenApiSpy {
  lastMethod: string | null
  lastPath: string | null
  callCount: number
  responsePayload: unknown
  responseError: Error | null
}

const openApiSpy: OpenApiSpy = {
  lastMethod: null,
  lastPath: null,
  callCount: 0,
  responsePayload: null,
  responseError: null,
}

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: async (_auth: Auth, method: string, path: string) => {
    openApiSpy.lastMethod = method
    openApiSpy.lastPath = path
    openApiSpy.callCount++
    if (openApiSpy.responseError) throw openApiSpy.responseError
    return openApiSpy.responsePayload
  },
}))

const { getExpandedSchedules } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar'] }

beforeEach(() => {
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { events: {}, occurrences: [], next_cursor: null }
})

describe('get_expanded_schedules', () => {
  it('lower/upper ISO → expanded 경로 + ts 쿼리', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe(
      '/v2/open/schedules/expanded?lower=1700000000&upper=1700086400',
    )
  })

  it('limit·cursor 있으면 쿼리에 포함', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
      limit: 50,
      cursor: 'abc',
    })
    expect(openApiSpy.lastPath).toBe(
      '/v2/open/schedules/expanded?lower=1700000000&upper=1700086400&limit=50&cursor=abc',
    )
  })

  it('limit·cursor 없으면 쿼리에서 생략', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastPath).not.toContain('limit')
    expect(openApiSpy.lastPath).not.toContain('cursor')
  })

  it('lower 누락 — zod throw, 백엔드 호출 안 함', async () => {
    await expect(
      getExpandedSchedules.execute(auth, { upper: '2023-11-14T22:13:20Z' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('raw 보존 + occurrences/events에 *_iso 형제 필드 추가', async () => {
    openApiSpy.responsePayload = {
      events: {
        's-1': {
          uuid: 's-1',
          name: 'meeting',
          is_todo: false,
          event_time: { time_type: 'at', timestamp: 1_700_000_000 },
          repeating: { start: 1_690_000_000, option: { optionType: 'every_day', interval: 1 } },
        },
      },
      occurrences: [
        {
          origin_event_id: 's-1',
          turn: 2,
          event_time: { time_type: 'at', timestamp: 1_700_086_400 },
        },
      ],
      next_cursor: 'eyJ0Ijo',
    }

    const result = (await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-15T00:00:00Z',
    })) as {
      occurrences: Array<{ event_time: Record<string, unknown> }>
      events: Record<string, { repeating: Record<string, unknown> }>
      next_cursor: string | null
    }

    expect(result.occurrences[0]?.event_time.timestamp_iso).toBe('2023-11-15T22:13:20.000Z')
    expect(result.occurrences[0]?.event_time.timestamp).toBe(1_700_086_400)
    expect(result.events['s-1']?.repeating.start_iso).toBe('2023-07-22T04:26:40.000Z')
    expect(result.next_cursor).toBe('eyJ0Ijo')
  })

  it('OpenApiError → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('window too large')
    await expect(
      getExpandedSchedules.execute(auth, {
        lower: '2023-11-14T00:00:00Z',
        upper: '2025-11-14T00:00:00Z',
      }),
    ).rejects.toThrow(/window too large/)
  })

  it('metadata — name·scope', () => {
    expect(getExpandedSchedules.name).toBe('get_expanded_schedules')
    expect(getExpandedSchedules.scopes).toEqual(['read:calendar'])
  })

  // 실제 openAPI(#244)의 events는 정규화 축소 객체 — uuid/name/is_todo/event_time/repeating만.
  // userId·event_tag_id·create_timestamp 등은 없음. full scheduleSchema로 문서화하면 Inspector 등
  // outputSchema 검증 클라가 'userId 누락'으로 거부함.
  it('outputSchema가 정규화 events(userId 없음·is_todo 있음)를 허용 — Inspector validation 회귀', () => {
    const real = {
      events: {
        s1: {
          uuid: 's1',
          name: 'meeting',
          is_todo: false,
          event_time: { time_type: 'at', timestamp: 1_700_000_000 },
          repeating: { start: 1_690_000_000, option: { optionType: 'every_day', interval: 1 } },
        },
      },
      occurrences: [
        { origin_event_id: 's1', turn: 1, event_time: { time_type: 'at', timestamp: 1_700_000_000 } },
      ],
      next_cursor: null,
    }
    expect(() => getExpandedSchedules.outputSchema.parse(real)).not.toThrow()
  })
})
