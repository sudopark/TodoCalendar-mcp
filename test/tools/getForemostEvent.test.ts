import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { NotFoundError } from '../../src/openapi/errors.js'

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

const { getForemostEvent } = await import('../../src/tools/foremostEventTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {}
})

describe('get_foremost_event — happy path', () => {
  it('GET /v2/open/foremost/event', async () => {
    await getForemostEvent.execute(auth, {})

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('unset 응답 {} 그대로 통과', async () => {
    openApiSpy.responsePayload = {}

    const result = await getForemostEvent.execute(auth, {})

    expect(result).toEqual({})
  })

  it('set 응답 — embedded schedule event_time에 *_iso 형제 필드 추가', async () => {
    openApiSpy.responsePayload = {
      event_id: 'evt-1',
      is_todo: false,
      event: {
        uuid: 'evt-1',
        userId: 'u-1',
        name: 'meeting',
        event_time: {
          time_type: 'period',
          period_start: 1700000000,
          period_end: 1700003600,
        },
      },
    }

    const result = (await getForemostEvent.execute(auth, {})) as Record<string, unknown>

    expect(result.event_id).toBe('evt-1')
    expect(result.is_todo).toBe(false)
    const event = result.event as Record<string, unknown>
    expect(event.uuid).toBe('evt-1')
    const et = event.event_time as Record<string, unknown>
    expect(et.period_start).toBe(1700000000)
    expect(et.period_end).toBe(1700003600)
    expect(et.period_start_iso).toBe('2023-11-14T22:13:20.000Z')
    expect(et.period_end_iso).toBe('2023-11-14T23:13:20.000Z')
  })

  it('set 응답 — embedded todo의 create_timestamp / event_time에 *_iso 추가', async () => {
    openApiSpy.responsePayload = {
      event_id: 't-1',
      is_todo: true,
      event: {
        uuid: 't-1',
        userId: 'u-1',
        name: 'urgent',
        is_current: false,
        create_timestamp: 1700000000,
        event_time: {
          time_type: 'at',
          timestamp: 1700001000,
        },
      },
    }

    const result = (await getForemostEvent.execute(auth, {})) as Record<string, unknown>

    const event = result.event as Record<string, unknown>
    expect(event.create_timestamp).toBe(1700000000)
    expect(event.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    const et = event.event_time as Record<string, unknown>
    expect(et.timestamp_iso).toBe('2023-11-14T22:30:00.000Z')
  })

  it('raw passthrough — unknown 필드 보존', async () => {
    openApiSpy.responsePayload = {
      event_id: 'evt-1',
      is_todo: true,
      event: { uuid: 'evt-1', userId: 'u-1', name: 'x', is_current: false, create_timestamp: 0 },
      extra_unknown_field: 'kept',
    }

    const result = (await getForemostEvent.execute(auth, {})) as Record<string, unknown>

    expect(result.extra_unknown_field).toBe('kept')
  })

  it('Tool 인자에 userId 변조 시도 — 무시', async () => {
    await getForemostEvent.execute(auth, { userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
  })
})

describe('get_foremost_event — error wrap', () => {
  it('NotFound → ToolError (자연어 보강)', async () => {
    openApiSpy.responseError = new NotFoundError('foremost not set')

    await expect(getForemostEvent.execute(auth, {})).rejects.toThrow(
      /The requested resource does not exist\. \(foremost not set\)/,
    )
  })
})

describe('get_foremost_event — metadata', () => {
  it('name·description·scopes·schemas 노출', () => {
    expect(getForemostEvent.name).toBe('get_foremost_event')
    expect(typeof getForemostEvent.description).toBe('string')
    expect(getForemostEvent.description.length).toBeGreaterThan(0)
    expect(getForemostEvent.scopes).toEqual(['read:calendar'])
    expect(getForemostEvent.inputSchema).toBeDefined()
    expect(getForemostEvent.outputSchema).toBeDefined()
  })
})
