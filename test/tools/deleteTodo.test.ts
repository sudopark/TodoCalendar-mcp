import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const SECRET = 'test-confirm-secret'

beforeEach(() => {
  vi.stubEnv('CONFIRM_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const { deleteTodo } = await import('../../src/tools/todoTools.js')

const auth: Auth = { userId: 'u-1' }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { status: 'ok' }
})

describe('delete_todo — 1단계: confirmToken 없으면 발급만, 실제 삭제 X', () => {
  it('confirmToken 없음 → confirm_required 응답, openAPI 호출 X', async () => {
    const result = await deleteTodo.execute(auth, { todo_id: 't-1' })

    expect(openApiSpy.callCount).toBe(0)
    expect(result).toMatchObject({
      status: 'confirm_required',
      action: 'delete_todo',
      target: { todo_id: 't-1' },
    })
    expect(typeof (result as { confirmToken: string }).confirmToken).toBe('string')
    expect(typeof (result as { message: string }).message).toBe('string')
  })

  it('발급된 confirmToken — HS256 + sub:userId + tool:delete_todo + argsHash 포함', async () => {
    const result = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }
    const decoded = jwt.verify(result.confirmToken, SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload

    expect(decoded.tool).toBe('delete_todo')
    expect(decoded.sub).toBe('u-1')
    expect(typeof decoded.argsHash).toBe('string')
    expect(decoded.exp).toBeTypeOf('number')
  })
})

describe('delete_todo — 2단계: 매치되는 confirmToken으로 재호출 → DELETE 실행', () => {
  it('DELETE /v2/open/todos/{id} 호출, raw {status:"ok"} 통과', async () => {
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }
    const result = await deleteTodo.execute(auth, {
      todo_id: 't-1',
      confirmToken: step1.confirmToken,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t-1')
    expect(openApiSpy.lastBody).toBeUndefined()
    expect(result).toEqual({ status: 'ok' })
  })

  it('todo_id URL 인코딩', async () => {
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't/with space' })) as {
      confirmToken: string
    }
    await deleteTodo.execute(auth, {
      todo_id: 't/with space',
      confirmToken: step1.confirmToken,
    })
    expect(openApiSpy.lastPath).toBe('/v2/open/todos/t%2Fwith%20space')
  })

  it('raw 응답 — unknown 필드도 그대로 통과', async () => {
    openApiSpy.responsePayload = { status: 'ok', extra_unknown_field: 'kept' }
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }
    const result = await deleteTodo.execute(auth, {
      todo_id: 't-1',
      confirmToken: step1.confirmToken,
    })
    expect(result).toEqual({ status: 'ok', extra_unknown_field: 'kept' })
  })
})

describe('delete_todo — confirmToken 거부 케이스', () => {
  it('다른 사용자가 발급받은 토큰 → SubMismatch ToolError', async () => {
    const otherStep1 = (await deleteTodo.execute(
      { userId: 'u-attacker' },
      { todo_id: 't-1' },
    )) as { confirmToken: string }

    await expect(
      deleteTodo.execute(auth, {
        todo_id: 't-1',
        confirmToken: otherStep1.confirmToken,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('다른 todo_id로 발급받은 토큰 → ArgsMismatch ToolError', async () => {
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }

    await expect(
      deleteTodo.execute(auth, { todo_id: 't-2', confirmToken: step1.confirmToken }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('다른 tool용 토큰 (예: delete_schedule 토큰) → ToolMismatch ToolError', async () => {
    const foreign = jwt.sign(
      { tool: 'delete_schedule', argsHash: 'whatever', sub: 'u-1' },
      SECRET,
      { algorithm: 'HS256', expiresIn: 300 },
    )

    await expect(
      deleteTodo.execute(auth, { todo_id: 't-1', confirmToken: foreign }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('만료된 토큰 (6분 후) → Expired ToolError', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }

    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'))
    await expect(
      deleteTodo.execute(auth, { todo_id: 't-1', confirmToken: step1.confirmToken }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('서명 없는/위조된 토큰 → Invalid ToolError', async () => {
    await expect(
      deleteTodo.execute(auth, { todo_id: 't-1', confirmToken: 'not-a-jwt' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })
})

describe('delete_todo — input validation', () => {
  it('todo_id 빈 문자열 — zod throw, 토큰 발급도 안 함', async () => {
    await expect(deleteTodo.execute(auth, { todo_id: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('todo_id 누락 — zod throw', async () => {
    await expect(deleteTodo.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도(top-level) — auth.userId만 사용, 토큰 sub도 auth.userId', async () => {
    const result = (await deleteTodo.execute(auth, {
      todo_id: 't-1',
      userId: 'attacker',
    })) as { confirmToken: string }
    const decoded = jwt.verify(result.confirmToken, SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload
    expect(decoded.sub).toBe('u-1')
  })
})

describe('delete_todo — error wrap (2단계 실행 시)', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    const step1 = (await deleteTodo.execute(auth, { todo_id: 'missing' })) as {
      confirmToken: string
    }
    openApiSpy.responseError = new NotFoundError('todo missing')

    await expect(
      deleteTodo.execute(auth, { todo_id: 'missing', confirmToken: step1.confirmToken }),
    ).rejects.toThrow(/The requested resource does not exist\. \(todo missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    const step1 = (await deleteTodo.execute(auth, { todo_id: 't-1' })) as {
      confirmToken: string
    }
    openApiSpy.responseError = new InvalidParameterError('id required')

    await expect(
      deleteTodo.execute(auth, { todo_id: 't-1', confirmToken: step1.confirmToken }),
    ).rejects.toThrow(/The request parameters are invalid\. \(id required\)/)
  })
})

describe('delete_todo — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(deleteTodo.name).toBe('delete_todo')
    expect(typeof deleteTodo.description).toBe('string')
    expect(deleteTodo.description.length).toBeGreaterThan(0)
    expect(deleteTodo.inputSchema).toBeDefined()
    expect(deleteTodo.outputSchema).toBeDefined()
  })

  it('description은 2단계 confirm 흐름 안내 포함', () => {
    expect(deleteTodo.description).toMatch(/confirmToken|two-step|confirm/i)
  })
})
