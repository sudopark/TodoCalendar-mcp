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

const { createTag } = await import('../../src/tools/tagTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 'tag-new',
    userId: 'u-1',
    name: 'work',
    color_hex: '#ff0000',
  }
})

describe('create_tag — happy path', () => {
  it('POST /v2/open/tags/ + body {name, color_hex}', async () => {
    await createTag.execute(auth, { name: 'work', color_hex: '#ff0000' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('POST')
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/')
    expect(openApiSpy.lastBody).toEqual({ name: 'work', color_hex: '#ff0000' })
  })

  it('color_hex 생략 — body에서도 omit', async () => {
    await createTag.execute(auth, { name: 'inbox' })

    expect(openApiSpy.lastBody).toEqual({ name: 'inbox' })
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 'tag-9',
      userId: 'u-1',
      name: 'travel',
      color_hex: null,
      extra_unknown_field: 'preserved',
    }
    openApiSpy.responsePayload = raw

    const result = await createTag.execute(auth, { name: 'travel' })

    expect(result).toEqual(raw)
  })
})

describe('create_tag — input validation', () => {
  it('name 누락 — zod throw, 백엔드 호출 X', async () => {
    await expect(createTag.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('name 빈 문자열 — zod throw', async () => {
    await expect(createTag.execute(auth, { name: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await createTag.execute(auth, { name: 'work', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'work' })
  })
})

describe('create_tag — error wrap', () => {
  it('OpenApiError → ToolError, 자연어 prefix 추가', async () => {
    openApiSpy.responseError = new InvalidParameterError('name conflict')

    await expect(createTag.execute(auth, { name: 'work' })).rejects.toThrow(
      /The request parameters are invalid\. \(name conflict\)/,
    )
  })
})

describe('create_tag — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(createTag.name).toBe('create_tag')
    expect(typeof createTag.description).toBe('string')
    expect(createTag.description.length).toBeGreaterThan(0)
    expect(createTag.inputSchema).toBeDefined()
    expect(createTag.outputSchema).toBeDefined()
  })
})
