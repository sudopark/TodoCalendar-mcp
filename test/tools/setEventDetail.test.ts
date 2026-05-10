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

const { setEventDetail } = await import('../../src/tools/eventDetailTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { place: 'home', url: null, memo: null }
})

describe('set_event_detail — happy path + 분기', () => {
  it('is_done=false — PUT /v2/open/event_details/{id} (active 라우트)', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'evt-1',
      is_done: false,
      detail: { place: 'home' },
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PUT')
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/evt-1')
    expect(openApiSpy.lastBody).toEqual({ place: 'home' })
  })

  it('is_done=true — PUT /v2/open/event_details/done/{id}', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'done-9',
      is_done: true,
      detail: { memo: 'finished' },
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/done/done-9')
    expect(openApiSpy.lastBody).toEqual({ memo: 'finished' })
  })

  it('event_id URL 인코딩 — 슬래시·공백 등 안전하게 escape', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'evt/with space',
      is_done: false,
      detail: { place: 'x' },
    })

    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/evt%2Fwith%20space')
  })

  it('detail 빈 객체도 body로 통과 (모든 필드 optional)', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'evt-1',
      is_done: false,
      detail: {},
    })

    expect(openApiSpy.lastBody).toEqual({})
  })

  it('place·url·memo 모두 — body에 그대로 통과', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'evt-1',
      is_done: false,
      detail: { place: 'home', url: 'https://x.example', memo: 'note' },
    })

    expect(openApiSpy.lastBody).toEqual({
      place: 'home',
      url: 'https://x.example',
      memo: 'note',
    })
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      place: 'home',
      url: null,
      memo: 'remember the milk',
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await setEventDetail.execute(auth, {
      event_id: 'evt-1',
      is_done: false,
      detail: { memo: 'remember the milk' },
    })

    expect(result).toEqual(raw)
  })
})

describe('set_event_detail — input validation', () => {
  it('event_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(
      setEventDetail.execute(auth, { event_id: '', is_done: false, detail: {} }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('is_done 누락 — zod throw', async () => {
    await expect(
      setEventDetail.execute(auth, { event_id: 'evt-1', detail: {} }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('detail 누락 — zod throw', async () => {
    await expect(
      setEventDetail.execute(auth, { event_id: 'evt-1', is_done: false }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await setEventDetail.execute(auth, {
      event_id: 'evt-1',
      is_done: false,
      detail: { place: 'x' },
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ place: 'x' })
  })
})

describe('set_event_detail — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('event not found')

    await expect(
      setEventDetail.execute(auth, {
        event_id: 'missing',
        is_done: false,
        detail: { place: 'x' },
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(event not found\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('url malformed')

    await expect(
      setEventDetail.execute(auth, {
        event_id: 'evt-1',
        is_done: false,
        detail: { url: 'not-a-url' },
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(url malformed\)/)
  })
})

describe('set_event_detail — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(setEventDetail.name).toBe('set_event_detail')
    expect(typeof setEventDetail.description).toBe('string')
    expect(setEventDetail.description.length).toBeGreaterThan(0)
    expect(setEventDetail.inputSchema).toBeDefined()
    expect(setEventDetail.outputSchema).toBeDefined()
  })
})
