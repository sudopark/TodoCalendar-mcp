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

const { setForemostEvent } = await import('../../src/tools/foremostEventTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    event_id: 'evt-1',
    is_todo: true,
    event: { uuid: 'evt-1', userId: 'u-1', name: 'x', is_current: false, create_timestamp: 0 },
  }
})

describe('set_foremost_event — happy path', () => {
  it('PUT /v2/open/foremost/event body {event_id, is_todo}', async () => {
    await setForemostEvent.execute(auth, { event_id: 'evt-1', is_todo: true })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PUT')
    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
    expect(openApiSpy.lastBody).toEqual({ event_id: 'evt-1', is_todo: true })
  })

  it('schedule(is_todo=false)도 동일 path — discriminator만 body로 전달', async () => {
    await setForemostEvent.execute(auth, { event_id: 's-1', is_todo: false })

    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
    expect(openApiSpy.lastBody).toEqual({ event_id: 's-1', is_todo: false })
  })

  it('embedded event(todo)의 create_timestamp / event_time에 *_iso 추가', async () => {
    openApiSpy.responsePayload = {
      event_id: 't-1',
      is_todo: true,
      event: {
        uuid: 't-1',
        userId: 'u-1',
        name: 'x',
        is_current: false,
        create_timestamp: 1700000000,
        event_time: { time_type: 'at', timestamp: 1700001000 },
      },
    }

    const result = (await setForemostEvent.execute(auth, {
      event_id: 't-1',
      is_todo: true,
    })) as Record<string, unknown>

    const event = result.event as Record<string, unknown>
    expect(event.create_timestamp).toBe(1700000000)
    expect(event.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    expect((event.event_time as Record<string, unknown>).timestamp_iso).toBe(
      '2023-11-14T22:30:00.000Z',
    )
  })

  it('raw passthrough — unknown 필드 보존', async () => {
    openApiSpy.responsePayload = {
      event_id: 'evt-1',
      is_todo: true,
      event: { uuid: 'evt-1', userId: 'u-1', name: 'x', is_current: false, create_timestamp: 0 },
      extra_unknown_field: 'kept',
    }

    const result = (await setForemostEvent.execute(auth, {
      event_id: 'evt-1',
      is_todo: true,
    })) as Record<string, unknown>

    expect(result.extra_unknown_field).toBe('kept')
  })
})

describe('set_foremost_event — input validation', () => {
  it('event_id 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(setForemostEvent.execute(auth, { is_todo: true })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_id 빈 문자열 — zod throw', async () => {
    await expect(
      setForemostEvent.execute(auth, { event_id: '', is_todo: true }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('is_todo 누락 — zod throw', async () => {
    await expect(setForemostEvent.execute(auth, { event_id: 'evt-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('is_todo가 boolean 아님(문자열) — zod throw (openAPI string 관용 파싱 제거 반영)', async () => {
    await expect(
      setForemostEvent.execute(auth, { event_id: 'evt-1', is_todo: 'true' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await setForemostEvent.execute(auth, {
      event_id: 'evt-1',
      is_todo: true,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ event_id: 'evt-1', is_todo: true })
  })
})

describe('set_foremost_event — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('missing target')

    await expect(
      setForemostEvent.execute(auth, { event_id: 'missing', is_todo: true }),
    ).rejects.toThrow(/The requested resource does not exist\. \(missing target\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_id missing')

    await expect(
      setForemostEvent.execute(auth, { event_id: 'evt-1', is_todo: true }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_id missing\)/)
  })
})

describe('set_foremost_event — metadata', () => {
  it('name·description·scopes·schemas 노출', () => {
    expect(setForemostEvent.name).toBe('set_foremost_event')
    expect(typeof setForemostEvent.description).toBe('string')
    expect(setForemostEvent.description.length).toBeGreaterThan(0)
    expect(setForemostEvent.scopes).toEqual(['write:calendar'])
    expect(setForemostEvent.inputSchema).toBeDefined()
    expect(setForemostEvent.outputSchema).toBeDefined()
  })
})
