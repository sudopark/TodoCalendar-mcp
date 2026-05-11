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

const { deleteDoneTodo } = await import('../../src/tools/doneTodoTools.js')

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

describe('delete_done_todo — happy path', () => {
  it('DELETE /v2/open/todos/dones/{id} — body 없음', async () => {
    await deleteDoneTodo.execute(auth, { done_todo_id: 'd-1' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/d-1')
    expect(openApiSpy.lastBody).toBeUndefined()
  })

  it('done_todo_id URL 인코딩', async () => {
    await deleteDoneTodo.execute(auth, { done_todo_id: 'd/with space' })
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/d%2Fwith%20space')
  })

  it('raw 응답 passthrough', async () => {
    const raw = { status: 'ok', extra_unknown_field: 'kept' }
    openApiSpy.responsePayload = raw

    const result = await deleteDoneTodo.execute(auth, { done_todo_id: 'd-1' })
    expect(result).toEqual(raw)
  })
})

describe('delete_done_todo — input validation', () => {
  it('done_todo_id 빈 문자열 — zod throw', async () => {
    await expect(deleteDoneTodo.execute(auth, { done_todo_id: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('done_todo_id 누락 — zod throw', async () => {
    await expect(deleteDoneTodo.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await deleteDoneTodo.execute(auth, { done_todo_id: 'd-1', userId: 'attacker' })
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toBeUndefined()
  })
})

describe('delete_done_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('done todo missing')

    await expect(deleteDoneTodo.execute(auth, { done_todo_id: 'missing' })).rejects.toThrow(
      /The requested resource does not exist\. \(done todo missing\)/,
    )
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('id required')

    await expect(deleteDoneTodo.execute(auth, { done_todo_id: 'd-1' })).rejects.toThrow(
      /The request parameters are invalid\. \(id required\)/,
    )
  })
})

describe('delete_done_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(deleteDoneTodo.name).toBe('delete_done_todo')
    expect(typeof deleteDoneTodo.description).toBe('string')
    expect(deleteDoneTodo.description.length).toBeGreaterThan(0)
    expect(deleteDoneTodo.inputSchema).toBeDefined()
    expect(deleteDoneTodo.outputSchema).toBeDefined()
  })

  it('description은 revert_done_todo와 구분되도록 비교 가이드 포함', () => {
    expect(deleteDoneTodo.description).toMatch(/revert/i)
  })
})
