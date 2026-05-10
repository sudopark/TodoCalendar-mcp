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

const { getEventDetails } = await import('../../src/tools/eventDetailTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  // happy-path default — minimal valid EventDetail
  openApiSpy.responsePayload = { place: null, url: null, memo: null }
})

describe('get_event_details — active/done 분기', () => {
  it('is_done=false → /v2/open/event_details/{id}', async () => {
    await getEventDetails.execute(auth, { event_id: 't-1', is_done: false })

    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/t-1')
  })

  it('is_done=true → /v2/open/event_details/done/{id}', async () => {
    await getEventDetails.execute(auth, { event_id: 'd-1', is_done: true })

    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/done/d-1')
  })

  it('event_id에 특수문자 — URL encoded', async () => {
    await getEventDetails.execute(auth, { event_id: 'a/b c', is_done: false })

    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/a%2Fb%20c')
  })

  it('is_done 누락 — zod throw', async () => {
    await expect(getEventDetails.execute(auth, { event_id: 't-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_id 누락 — zod throw', async () => {
    await expect(getEventDetails.execute(auth, { is_done: false })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_id 빈 문자열 — zod throw (list endpoint 충돌 방지)', async () => {
    await expect(
      getEventDetails.execute(auth, { event_id: '', is_done: false }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('Tool 인자에 userId 변조 시도 — 무시', async () => {
    await getEventDetails.execute(auth, {
      event_id: 't-1',
      is_done: false,
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/event_details/t-1')
  })

  it('raw 응답 통과', async () => {
    const raw = { place: '강남역', url: 'https://x', memo: '메모' }
    openApiSpy.responsePayload = raw

    const result = await getEventDetails.execute(auth, { event_id: 't-1', is_done: false })

    expect(result).toEqual(raw)
  })

  it('NotFound → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('')

    await expect(getEventDetails.execute(auth, { event_id: 'x', is_done: false })).rejects.toThrow(
      /The requested resource does not exist\./,
    )
  })
})
