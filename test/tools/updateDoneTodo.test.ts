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

const { updateDoneTodo } = await import('../../src/tools/doneTodoTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = {
    uuid: 'done-1',
    userId: 'u-1',
    name: 'renamed',
  }
})

describe('update_done_todo — happy path', () => {
  it('단일 필드(name) — PUT /v2/open/todos/dones/{id} + body {name}', async () => {
    await updateDoneTodo.execute(auth, { done_todo_id: 'done-1', name: 'renamed' })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastMethod).toBe('PUT')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/done-1')
    expect(openApiSpy.lastBody).toEqual({ name: 'renamed' })
  })

  it('event_time(period) + event_tag_id 동시 — body에 모두 포함', async () => {
    await updateDoneTodo.execute(auth, {
      done_todo_id: 'done-1',
      event_tag_id: 'tag-2',
      event_time: {
        time_type: 'period',
        period_start: 1_700_000_000,
        period_end: 1_700_003_600,
      },
    })

    expect(openApiSpy.lastBody).toEqual({
      event_tag_id: 'tag-2',
      event_time: {
        time_type: 'period',
        period_start: 1_700_000_000,
        period_end: 1_700_003_600,
      },
    })
  })

  it('done_todo_id URL 인코딩', async () => {
    await updateDoneTodo.execute(auth, { done_todo_id: 'done/with space', name: 'x' })

    expect(openApiSpy.lastPath).toBe('/v2/open/todos/dones/done%2Fwith%20space')
  })

  it('raw 응답 그대로 반환 (passthrough)', async () => {
    const raw = {
      uuid: 'done-1',
      userId: 'u-1',
      name: 'renamed',
      done_at: 1_700_000_000,
      extra_unknown_field: 'kept',
    }
    openApiSpy.responsePayload = raw

    const result = await updateDoneTodo.execute(auth, {
      done_todo_id: 'done-1',
      name: 'renamed',
    })

    expect(result).toEqual(raw)
  })
})

describe('update_done_todo — input validation', () => {
  it('done_todo_id 빈 문자열 — zod throw', async () => {
    await expect(
      updateDoneTodo.execute(auth, { done_todo_id: '', name: 'x' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('event_time.time_type 알 수 없음 — zod throw', async () => {
    await expect(
      updateDoneTodo.execute(auth, {
        done_todo_id: 'done-1',
        event_time: { time_type: 'never', timestamp: 1 },
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — body·auth에 흘러가지 않음', async () => {
    await updateDoneTodo.execute(auth, {
      done_todo_id: 'done-1',
      name: 'x',
      userId: 'attacker',
    })

    expect(openApiSpy.lastAuth).toBe(auth)
    expect(openApiSpy.lastBody).toEqual({ name: 'x' })
  })
})

describe('update_done_todo — error wrap', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    openApiSpy.responseError = new NotFoundError('done todo missing')

    await expect(
      updateDoneTodo.execute(auth, { done_todo_id: 'missing', name: 'x' }),
    ).rejects.toThrow(/The requested resource does not exist\. \(done todo missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('event_time invalid')

    await expect(
      updateDoneTodo.execute(auth, {
        done_todo_id: 'done-1',
        event_time: { time_type: 'at', timestamp: 1 },
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(event_time invalid\)/)
  })
})

describe('update_done_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(updateDoneTodo.name).toBe('update_done_todo')
    expect(typeof updateDoneTodo.description).toBe('string')
    expect(updateDoneTodo.description.length).toBeGreaterThan(0)
    expect(updateDoneTodo.inputSchema).toBeDefined()
    expect(updateDoneTodo.outputSchema).toBeDefined()
  })
})
