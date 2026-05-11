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

const { updateTag } = await import('../../src/tools/tagTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 'tag-1',
    userId: 'u-1',
    name: 'renamed',
    color_hex: '#ff0000',
  }
})

describe('update_tag — happy path', () => {
  it('name만 — PUT /v2/open/tags/{id} + body {name}', async () => {
    await updateTag.execute(auth, { tag_id: 'tag-1', name: 'renamed' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PUT')
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/tag-1')
    expect(openApiSpy.lastBody).toEqual({ name: 'renamed' })
  })

  it('color_hex + skipCheckDuplicationName 동시 — 모두 body 포함', async () => {
    await updateTag.execute(auth, {
      tag_id: 'tag-1',
      name: 'work',
      color_hex: '#00ff00',
      skipCheckDuplicationName: true,
    })

    expect(openApiSpy.lastBody).toEqual({
      name: 'work',
      color_hex: '#00ff00',
      skipCheckDuplicationName: true,
    })
  })

  it('tag_id URL 인코딩', async () => {
    await updateTag.execute(auth, { tag_id: 'tag/with space', name: 'x' })

    expect(openApiSpy.lastPath).toBe('/v2/open/tags/tag%2Fwith%20space')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 'tag-1',
      userId: 'u-1',
      name: 'renamed',
      color_hex: null,
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await updateTag.execute(auth, { tag_id: 'tag-1', name: 'renamed' })

    expect(result).toEqual(raw)
  })
})

describe('update_tag — input validation', () => {
  it('tag_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(updateTag.execute(auth, { tag_id: '', name: 'x' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('name 누락 — zod throw (PUT은 name 필수)', async () => {
    await expect(updateTag.execute(auth, { tag_id: 'tag-1' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('name 빈 문자열 — zod throw', async () => {
    await expect(updateTag.execute(auth, { tag_id: 'tag-1', name: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await updateTag.execute(auth, { tag_id: 'tag-1', name: 'x', userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x' })
  })
})

describe('update_tag — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('tag missing')

    await expect(
      updateTag.execute(auth, { tag_id: 'missing', name: 'x' }),
    ).rejects.toThrow(/The requested resource does not exist\. \(tag missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError — name 중복', async () => {
    openApiSpy.responseError = new InvalidParameterError('name conflict')

    await expect(
      updateTag.execute(auth, { tag_id: 'tag-1', name: 'dup' }),
    ).rejects.toThrow(/The request parameters are invalid\. \(name conflict\)/)
  })
})

describe('update_tag — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(updateTag.name).toBe('update_tag')
    expect(typeof updateTag.description).toBe('string')
    expect(updateTag.description.length).toBeGreaterThan(0)
    expect(updateTag.inputSchema).toBeDefined()
    expect(updateTag.outputSchema).toBeDefined()
  })
})
