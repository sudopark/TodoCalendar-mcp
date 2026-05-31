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

const { clearForemostEvent } = await import('../../src/tools/foremostEventTools.js')

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

describe('clear_foremost_event — happy path', () => {
  it('DELETE /v2/open/foremost/event — body 없음', async () => {
    await clearForemostEvent.execute(auth, {})

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('status:ok 응답 통과', async () => {
    const result = (await clearForemostEvent.execute(auth, {})) as { status: string }

    expect(result.status).toBe('ok')
  })

  it('raw passthrough — unknown 필드 보존', async () => {
    openApiSpy.responsePayload = { status: 'ok', extra: 'kept' }

    const result = (await clearForemostEvent.execute(auth, {})) as Record<string, unknown>

    expect(result).toEqual({ status: 'ok', extra: 'kept' })
  })

  it('Tool 인자에 userId 변조 시도 — 무시 (confirm 없이 즉시 실행)', async () => {
    await clearForemostEvent.execute(auth, { userId: 'attacker' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/foremost/event')
  })
})

describe('clear_foremost_event — confirm 미적용', () => {
  it('confirmToken 인자 없이 첫 호출에서 바로 DELETE 실행', async () => {
    await clearForemostEvent.execute(auth, {})

    // 첫 호출이지만 confirm_required envelope 안 돌려주고 바로 DELETE
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.callCount).toBe(1)
  })
})

describe('clear_foremost_event — error wrap', () => {
  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('cannot clear')

    await expect(clearForemostEvent.execute(auth, {})).rejects.toThrow(
      /The request parameters are invalid\. \(cannot clear\)/,
    )
  })
})

describe('clear_foremost_event — metadata', () => {
  it('name·description·scopes·schemas 노출', () => {
    expect(clearForemostEvent.name).toBe('clear_foremost_event')
    expect(typeof clearForemostEvent.description).toBe('string')
    expect(clearForemostEvent.description.length).toBeGreaterThan(0)
    expect(clearForemostEvent.scopes).toEqual(['write:calendar'])
    expect(clearForemostEvent.inputSchema).toBeDefined()
    expect(clearForemostEvent.outputSchema).toBeDefined()
  })
})
