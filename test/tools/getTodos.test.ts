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

const { getTodos } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  // happy-path default — empty Todo[]
  openApiSpy.responsePayload = []
})

describe('get_todos — mode 분기', () => {
  it('current — query string 없이 GET /v2/open/todos/', async () => {
    await getTodos.execute(auth, { mode: 'current' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/')
  })

  it('range — lower/upper 쿼리스트링', async () => {
    await getTodos.execute(auth, { mode: 'range', lower: 1_700_000_000, upper: 1_700_086_400 })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/?lower=1700000000&upper=1700086400')
  })

  it('uncompleted — refTime 쿼리스트링, /uncompleted 경로', async () => {
    await getTodos.execute(auth, { mode: 'uncompleted', refTime: 1_700_000_000 })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/uncompleted?refTime=1700000000')
  })

  it('range — lower/upper 동일 값 허용 (서버에 위임)', async () => {
    await getTodos.execute(auth, { mode: 'range', lower: 100, upper: 100 })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/?lower=100&upper=100')
  })
})

describe('get_todos — input validation', () => {
  it('mode 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(getTodos.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('range mode인데 upper 누락 — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'range', lower: 1 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('uncompleted mode인데 refTime 누락 — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'uncompleted' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('알 수 없는 mode — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'past' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('Tool 인자에 userId 변조 시도 — 무시되고 auth.userId가 그대로 client에 전달', async () => {
    await getTodos.execute(auth, { mode: 'current', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/')
  })
})

describe('get_todos — 응답 raw 통과', () => {
  it('userId·timestamp 등 변환 없이 그대로 반환', async () => {
    const raw = [
      {
        uuid: 't-1',
        userId: 'u-1',
        name: 'meeting',
        is_current: false,
        create_timestamp: 1_700_000_000,
        event_time: { time_type: 'at', timestamp: 1_700_003_600 },
        repeating: {
          start: 1_700_000_000,
          option: { optionType: 'every_day', interval: 1 },
        },
      },
    ]
    openApiSpy.responsePayload = raw

    const result = await getTodos.execute(auth, { mode: 'current' })

    expect(result).toEqual(raw)
    expect(result[0]).toHaveProperty('userId', 'u-1')
    expect(result[0]?.create_timestamp).toBe(1_700_000_000)
  })
})

describe('get_todos — error 자연어 wrap', () => {
  it('OpenApiError → ToolError, 영어 prefix 보강', async () => {
    openApiSpy.responseError = new InvalidParameterError('lower required')

    await expect(getTodos.execute(auth, { mode: 'range', lower: 1, upper: 2 })).rejects.toThrow(
      /The request parameters are invalid\. \(lower required\)/,
    )
  })
})

describe('get_todos — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(getTodos.name).toBe('get_todos')
    expect(getTodos.description).toMatch(/Unix epoch seconds/)
    expect(getTodos.inputSchema).toBeDefined()
    expect(getTodos.outputSchema).toBeDefined()
  })
})
