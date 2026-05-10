import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidParameterError } from '../../src/openapi/errors.js'

const callOpenApi = vi.fn()

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: (...args: unknown[]) => callOpenApi(...args),
}))

const { getTodos } = await import('../../src/tools/todoTools.js')

const auth = { userId: 'u-1' }

const todoFixture = {
  uuid: 't-1',
  userId: 'u-1',
  name: 'work out',
  is_current: true,
  create_timestamp: 1_700_000_000,
}

beforeEach(() => {
  callOpenApi.mockReset()
})

describe('get_todos — mode 분기', () => {
  it('current — query string 없이 GET /v2/open/todos/', async () => {
    callOpenApi.mockResolvedValue([todoFixture])
    const result = await getTodos.execute(auth, { mode: 'current' })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/todos/')
    expect(result).toEqual([todoFixture])
  })

  it('range — lower/upper 쿼리스트링', async () => {
    callOpenApi.mockResolvedValue([])
    await getTodos.execute(auth, {
      mode: 'range',
      lower: 1_700_000_000,
      upper: 1_700_086_400,
    })
    expect(callOpenApi).toHaveBeenCalledWith(
      auth,
      'GET',
      '/v2/open/todos/?lower=1700000000&upper=1700086400',
    )
  })

  it('uncompleted — refTime 쿼리스트링, /uncompleted 경로', async () => {
    callOpenApi.mockResolvedValue([todoFixture])
    await getTodos.execute(auth, { mode: 'uncompleted', refTime: 1_700_000_000 })
    expect(callOpenApi).toHaveBeenCalledWith(
      auth,
      'GET',
      '/v2/open/todos/uncompleted?refTime=1700000000',
    )
  })

  it('range — lower/upper 동일 값 허용 (서버에 위임)', async () => {
    callOpenApi.mockResolvedValue([])
    await getTodos.execute(auth, { mode: 'range', lower: 100, upper: 100 })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/todos/?lower=100&upper=100')
  })
})

describe('get_todos — input validation', () => {
  it('mode 누락 — zod throw', async () => {
    await expect(getTodos.execute(auth, {})).rejects.toThrow()
  })

  it('range mode인데 upper 누락 — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'range', lower: 1 })).rejects.toThrow()
  })

  it('uncompleted mode인데 refTime 누락 — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'uncompleted' })).rejects.toThrow()
  })

  it('알 수 없는 mode — zod throw', async () => {
    await expect(getTodos.execute(auth, { mode: 'past' })).rejects.toThrow()
  })

  it('Tool 인자에 userId 변조 시도 — 무시되고 auth.userId가 그대로 client에 전달', async () => {
    callOpenApi.mockResolvedValue([])
    await getTodos.execute(auth, { mode: 'current', userId: 'attacker' })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/todos/')
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
    callOpenApi.mockResolvedValue(raw)
    const result = await getTodos.execute(auth, { mode: 'current' })
    expect(result).toEqual(raw)
    expect(result[0]).toHaveProperty('userId', 'u-1')
    expect(result[0]?.create_timestamp).toBe(1_700_000_000)
  })
})

describe('get_todos — error 자연어 wrap', () => {
  it('OpenApiError → ToolError, 영어 prefix 보강', async () => {
    callOpenApi.mockRejectedValue(new InvalidParameterError('lower required'))
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
