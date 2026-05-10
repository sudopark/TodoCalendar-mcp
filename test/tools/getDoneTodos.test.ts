import { beforeEach, describe, expect, it, vi } from 'vitest'

const callOpenApi = vi.fn()

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: (...args: unknown[]) => callOpenApi(...args),
}))

const { getDoneTodos } = await import('../../src/tools/doneTodoTools.js')

const auth = { userId: 'u-1' }

beforeEach(() => {
  callOpenApi.mockReset()
})

describe('get_done_todos', () => {
  it('size 미지정 — default 50으로 호출', async () => {
    callOpenApi.mockResolvedValue({ dones: [], next_cursor: null })
    await getDoneTodos.execute(auth, {})
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/todos/dones/?size=50')
  })

  it('size 명시 — 그대로', async () => {
    callOpenApi.mockResolvedValue({ dones: [] })
    await getDoneTodos.execute(auth, { size: 30 })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/todos/dones/?size=30')
  })

  it('cursor 있으면 size+cursor 둘 다', async () => {
    callOpenApi.mockResolvedValue({ dones: [] })
    await getDoneTodos.execute(auth, { size: 20, cursor: 1_700_000_000 })
    expect(callOpenApi).toHaveBeenCalledWith(
      auth,
      'GET',
      '/v2/open/todos/dones/?size=20&cursor=1700000000',
    )
  })

  it('size > 200 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 201 })).rejects.toThrow()
  })

  it('size < 1 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 0 })).rejects.toThrow()
  })

  it('size 비정수 — zod throw', async () => {
    await expect(getDoneTodos.execute(auth, { size: 1.5 })).rejects.toThrow()
  })

  it('raw 응답 통과 — done_at·next_cursor 보존', async () => {
    const raw = {
      dones: [
        {
          uuid: 'd-1',
          userId: 'u-1',
          name: '완료',
          done_at: 1_700_000_000,
        },
      ],
      next_cursor: 1_699_000_000,
    }
    callOpenApi.mockResolvedValue(raw)
    const result = await getDoneTodos.execute(auth, { size: 1 })
    expect(result).toEqual(raw)
  })
})
