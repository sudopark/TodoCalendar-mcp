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

const { getExpandedTodos } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar'] }

beforeEach(() => {
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { events: {}, occurrences: [], next_cursor: null }
})

describe('get_expanded_todos', () => {
  it('lower/upper ISO → expanded 경로 + ts 쿼리', async () => {
    await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/expanded?lower=1700000000&upper=1700086400')
  })

  it('limit·cursor 있으면 쿼리에 포함', async () => {
    await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
      limit: 50,
      cursor: 'abc',
    })
    expect(openApiSpy.lastPath).toBe(
      '/v2/open/todos/expanded?lower=1700000000&upper=1700086400&limit=50&cursor=abc',
    )
  })

  it('limit·cursor 없으면 쿼리에서 생략', async () => {
    await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastPath).not.toContain('limit')
    expect(openApiSpy.lastPath).not.toContain('cursor')
  })

  it('lower 누락 — zod throw, 백엔드 호출 안 함', async () => {
    await expect(
      getExpandedTodos.execute(auth, { upper: '2023-11-14T22:13:20Z' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('raw 보존 + occurrences/events에 *_iso 형제 필드 추가', async () => {
    openApiSpy.responsePayload = {
      events: {
        'todo-1': {
          uuid: 'todo-1',
          userId: 'u-1',
          name: 'standup',
          is_current: false,
          create_timestamp: 1_690_000_000,
          event_time: { time_type: 'at', timestamp: 1_700_000_000 },
          repeating: { start: 1_690_000_000, option: { optionType: 'every_day', interval: 1 } },
        },
      },
      occurrences: [
        {
          origin_event_id: 'todo-1',
          turn: 2,
          event_time: { time_type: 'at', timestamp: 1_700_086_400 },
        },
      ],
      next_cursor: null,
    }

    const result = (await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-15T00:00:00Z',
    })) as Record<string, any>

    expect(result.occurrences[0].event_time.timestamp_iso).toBe('2023-11-15T22:13:20.000Z')
    expect(result.occurrences[0].event_time.timestamp).toBe(1_700_086_400)
    expect(result.events['todo-1'].repeating.start_iso).toBe('2023-07-22T04:26:40.000Z')
    expect(result.events['todo-1'].create_timestamp_iso).toBe('2023-07-22T04:26:40.000Z')
    expect(result.next_cursor).toBeNull()
  })

  it('OpenApiError → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('window too large')
    await expect(
      getExpandedTodos.execute(auth, {
        lower: '2023-11-14T00:00:00Z',
        upper: '2025-11-14T00:00:00Z',
      }),
    ).rejects.toThrow(/window too large/)
  })

  it('metadata — name·scope', () => {
    expect(getExpandedTodos.name).toBe('get_expanded_todos')
    expect(getExpandedTodos.scopes).toEqual(['read:calendar'])
  })
})
