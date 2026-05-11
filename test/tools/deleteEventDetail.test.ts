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

const { deleteEventDetail } = await import('../../src/tools/eventDetailTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { status: 'ok' }
})

describe('delete_event_detail — is_done 라우트 분기', () => {
  it('is_done=false → /v2/open/event_details/{id} (active)', async () => {
    await deleteEventDetail.execute(auth, { event_id: 'e-1', is_done: false })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/e-1')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('is_done=true → /v2/open/event_details/done/{id} (done)', async () => {
    await deleteEventDetail.execute(auth, { event_id: 'd-1', is_done: true })

    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/done/d-1')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('event_id URL 인코딩 — active', async () => {
    await deleteEventDetail.execute(auth, { event_id: 'e/with space', is_done: false })
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/e%2Fwith%20space')
  })

  it('event_id URL 인코딩 — done', async () => {
    await deleteEventDetail.execute(auth, { event_id: 'e/with space', is_done: true })
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/done/e%2Fwith%20space')
  })
})

describe('delete_event_detail — happy path', () => {
  it('auth 전달 + raw passthrough', async () => {
    const raw = { status: 'ok', extra_unknown_field: 'kept' }
    openApiSpy.responsePayload = raw

    const result = await deleteEventDetail.execute(auth, { event_id: 'e-1', is_done: false })
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(result).toEqual(raw)
  })
})

describe('delete_event_detail — input validation', () => {
  it('event_id 빈 문자열 — zod throw', async () => {
    await expect(
      deleteEventDetail.execute(auth, { event_id: '', is_done: false }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_id 누락 — zod throw', async () => {
    await expect(deleteEventDetail.execute(auth, { is_done: false })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('is_done 누락 — zod throw (필수, default false 없음)', async () => {
    await expect(deleteEventDetail.execute(auth, { event_id: 'e-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('is_done이 boolean이 아님 — zod throw (string "true" coerce 안 함)', async () => {
    await expect(
      deleteEventDetail.execute(auth, { event_id: 'e-1', is_done: 'true' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await deleteEventDetail.execute(auth, {
      event_id: 'e-1',
      is_done: false,
      userId: 'attacker',
    })
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toBeUndefined()
  })
})

describe('delete_event_detail — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('detail missing')

    await expect(
      deleteEventDetail.execute(auth, { event_id: 'missing', is_done: false }),
    ).rejects.toThrow(/The requested resource does not exist\. \(detail missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('id required')

    await expect(
      deleteEventDetail.execute(auth, { event_id: 'e-1', is_done: false }),
    ).rejects.toThrow(/The request parameters are invalid\. \(id required\)/)
  })
})

describe('delete_event_detail — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(deleteEventDetail.name).toBe('delete_event_detail')
    expect(typeof deleteEventDetail.description).toBe('string')
    expect(deleteEventDetail.description.length).toBeGreaterThan(0)
    expect(deleteEventDetail.inputSchema).toBeDefined()
    expect(deleteEventDetail.outputSchema).toBeDefined()
  })

  it('description은 is_done 라우트 분기 가이드 포함', () => {
    expect(deleteEventDetail.description).toMatch(/is_done/i)
  })

  it('description은 done todo 자체 복원은 revert_done_todo를 쓰라고 안내', () => {
    expect(deleteEventDetail.description).toMatch(/revert_done_todo/i)
  })
})
