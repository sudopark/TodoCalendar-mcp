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

const { deleteTag } = await import('../../src/tools/tagTools.js')

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

describe('delete_tag — happy path', () => {
  it('DELETE /v2/open/tags/{id} 호출 — body 없음', async () => {
    await deleteTag.execute(auth, { tag_id: 'tag-1' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/tag-1')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('tag_id URL 인코딩', async () => {
    await deleteTag.execute(auth, { tag_id: 'tag/with space' })
    expect(openApiSpy.lastPath).toBe('/v2/open/tags/tag%2Fwith%20space')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = { status: 'ok', extra_unknown_field: 'kept' }
    openApiSpy.responsePayload = raw

    const result = await deleteTag.execute(auth, { tag_id: 'tag-1' })
    expect(result).toEqual(raw)
  })
})

describe('delete_tag — input validation', () => {
  it('tag_id 빈 문자열 — zod throw, 백엔드 호출 X', async () => {
    await expect(deleteTag.execute(auth, { tag_id: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('tag_id 누락 — zod throw', async () => {
    await expect(deleteTag.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await deleteTag.execute(auth, { tag_id: 'tag-1', userId: 'attacker' })
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toBeUndefined()
  })
})

describe('delete_tag — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('tag missing')

    await expect(deleteTag.execute(auth, { tag_id: 'missing' })).rejects.toThrow(
      /The requested resource does not exist\. \(tag missing\)/,
    )
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('id required')

    await expect(deleteTag.execute(auth, { tag_id: 'tag-1' })).rejects.toThrow(
      /The request parameters are invalid\. \(id required\)/,
    )
  })
})

describe('delete_tag — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(deleteTag.name).toBe('delete_tag')
    expect(typeof deleteTag.description).toBe('string')
    expect(deleteTag.description.length).toBeGreaterThan(0)
    expect(deleteTag.inputSchema).toBeDefined()
    expect(deleteTag.outputSchema).toBeDefined()
  })

  it('description은 CONFIRM 면제임을 안내하지 않음 (강제 아닌 단순 삭제)', () => {
    expect(deleteTag.description).not.toMatch(/confirmToken|CONFIRM/i)
  })
})
