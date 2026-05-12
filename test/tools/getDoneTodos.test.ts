import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'

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

const { getDoneTodos } = await import('../../src/tools/doneTodoTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  // happy-path default — empty array (swagger: response is `DoneTodo[]`)
  openApiSpy.responsePayload = []
})

describe('get_done_todos', () => {
  it('size 미지정 — default 50으로 호출', async () => {
    await getDoneTodos.execute(auth, {})

    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/?size=50')
  })

  it('size 명시 — 그대로', async () => {
    await getDoneTodos.execute(auth, { size: 30 })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/?size=30')
  })

  it('cursor 있으면 size+cursor 둘 다', async () => {
    await getDoneTodos.execute(auth, { size: 20, cursor: 1_700_000_000 })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/?size=20&cursor=1700000000')
  })

  it('cursor=null — round-trip 허용 (이전 응답의 cursor=null을 그대로 전달 가능)', async () => {
    await getDoneTodos.execute(auth, { size: 20, cursor: null })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/?size=20')
  })

  it('Tool 인자에 userId 변조 시도 — 무시', async () => {
    await getDoneTodos.execute(auth, { size: 10, userId: 'attacker' })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/?size=10')
  })

  it('size > 200 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 201 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('size < 1 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 0 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('size 비정수 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 1.5 })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('raw 응답 통과 — DoneTodo[] 배열 그대로', async () => {
    const raw = [
      {
        uuid: 'd-1',
        userId: 'u-1',
        name: '완료',
        done_at: 1_700_000_000,
      },
    ]
    openApiSpy.responsePayload = raw

    const result = await getDoneTodos.execute(auth, { size: 1 })

    expect(result).toEqual(raw)
  })
})
