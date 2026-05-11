import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InsufficientScopeError } from '../../src/openapi/errors.js'

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

const { getTags } = await import('../../src/tools/tagTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = []
})

describe('get_tags', () => {
  it('GET /v2/open/tags/all 호출, 인자 없음', async () => {
    await getTags.execute(auth, {})

    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/all')
  })

  it('raw 응답 — userId·color_hex 보존', async () => {
    const raw = [
      { uuid: 'tag-1', userId: 'u-1', name: 'work', color_hex: '#ff0000' },
      { uuid: 'tag-2', userId: 'u-1', name: 'personal', color_hex: null },
    ]
    openApiSpy.responsePayload = raw

    const result = await getTags.execute(auth, {})

    expect(result).toEqual(raw)
  })

  it('알 수 없는 인자도 통과 (zod object는 unknown key 허용) — userId 변조 시도 무시', async () => {
    await getTags.execute(auth, { userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/all')
  })

  it('InsufficientScope → ToolError', async () => {
    openApiSpy.responseError = new InsufficientScopeError('read:calendar')

    await expect(getTags.execute(auth, {})).rejects.toThrow(
      /The auth token lacks the required scope\. \(read:calendar\)/,
    )
  })
})
