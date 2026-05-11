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

const { deleteSchedule } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar', 'write:calendar'] }

beforeEach(() => {
  openApiSpy.lastAuth = null
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.lastBody = undefined
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  // openAPI schedule DELETE는 201로 응답하지만 페이로드는 StatusOk 동일
  openApiSpy.responsePayload = { status: 'ok' }
})

describe('delete_schedule — 1단계: confirmToken 없으면 발급만', () => {
  it('confirmToken 없음 → confirm_required 응답, openAPI 호출 X', async () => {
    const result = await deleteSchedule.execute(auth, { schedule_id: 's-1' })

    expect(openApiSpy.callCount).toBe(0)
    expect(result).toMatchObject({
      status: 'confirm_required',
      action: 'delete_schedule',
      target: { schedule_id: 's-1' },
    })
    expect(typeof (result as { confirmToken: string }).confirmToken).toBe('string')
  })

  it('발급된 confirmToken — sub:userId + tool:delete_schedule 포함', async () => {
    const result = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }
    const decoded = jwt.verify(result.confirmToken, SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload

    expect(decoded.tool).toBe('delete_schedule')
    expect(decoded.sub).toBe('u-1')
  })
})

describe('delete_schedule — 2단계: 매치되는 토큰 → 실제 DELETE', () => {
  it('DELETE /v2/open/schedules/{id} 호출, raw 통과', async () => {
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }
    const result = await deleteSchedule.execute(auth, {
      schedule_id: 's-1',
      confirmToken: step1.confirmToken,
    })

    expect(openApiSpy.callCount).toBe(1)
    expect(openApiSpy.lastMethod).toBe('DELETE')
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s-1')
    expect(result).toEqual({ status: 'ok' })
  })

  it('schedule_id URL 인코딩', async () => {
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's/with space' })) as {
      confirmToken: string
    }
    await deleteSchedule.execute(auth, {
      schedule_id: 's/with space',
      confirmToken: step1.confirmToken,
    })
    expect(openApiSpy.lastPath).toBe('/v2/open/schedules/s%2Fwith%20space')
  })

  it('openAPI 201 응답도 raw 그대로 통과 (schedule DELETE만 201 특이)', async () => {
    openApiSpy.responsePayload = { status: 'ok', extra: 'kept' }
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }
    const result = await deleteSchedule.execute(auth, {
      schedule_id: 's-1',
      confirmToken: step1.confirmToken,
    })
    expect(result).toEqual({ status: 'ok', extra: 'kept' })
  })
})

describe('delete_schedule — confirmToken 거부 케이스', () => {
  it('다른 사용자가 발급받은 토큰 → SubMismatch ToolError', async () => {
    const otherStep1 = (await deleteSchedule.execute(
      { userId: 'u-attacker', scopes: ['read:calendar', 'write:calendar'] },
      { schedule_id: 's-1' },
    )) as { confirmToken: string }

    await expect(
      deleteSchedule.execute(auth, {
        schedule_id: 's-1',
        confirmToken: otherStep1.confirmToken,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('다른 schedule_id로 발급받은 토큰 → ArgsMismatch ToolError', async () => {
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }

    await expect(
      deleteSchedule.execute(auth, { schedule_id: 's-2', confirmToken: step1.confirmToken }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('delete_todo 토큰으로 delete_schedule 호출 → ToolMismatch ToolError', async () => {
    const foreign = jwt.sign(
      { tool: 'delete_todo', argsHash: 'whatever', sub: 'u-1' },
      SECRET,
      { algorithm: 'HS256', expiresIn: 300 },
    )

    await expect(
      deleteSchedule.execute(auth, { schedule_id: 's-1', confirmToken: foreign }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('만료된 토큰 → Expired ToolError', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }

    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'))
    await expect(
      deleteSchedule.execute(auth, {
        schedule_id: 's-1',
        confirmToken: step1.confirmToken,
      }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('위조 토큰 → Invalid ToolError', async () => {
    await expect(
      deleteSchedule.execute(auth, { schedule_id: 's-1', confirmToken: 'not-a-jwt' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })
})

describe('delete_schedule — input validation', () => {
  it('schedule_id 빈 문자열 — zod throw', async () => {
    await expect(deleteSchedule.execute(auth, { schedule_id: '' })).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('schedule_id 누락 — zod throw', async () => {
    await expect(deleteSchedule.execute(auth, {})).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('userId 변조 시도 — auth.userId만 사용, 토큰 sub도 auth.userId', async () => {
    const result = (await deleteSchedule.execute(auth, {
      schedule_id: 's-1',
      userId: 'attacker',
    })) as { confirmToken: string }
    const decoded = jwt.verify(result.confirmToken, SECRET, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload
    expect(decoded.sub).toBe('u-1')
  })
})

describe('delete_schedule — error wrap (2단계 실행 시)', () => {
  it('OpenApiError(NotFound) → ToolError', async () => {
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 'missing' })) as {
      confirmToken: string
    }
    openApiSpy.responseError = new NotFoundError('schedule missing')

    await expect(
      deleteSchedule.execute(auth, {
        schedule_id: 'missing',
        confirmToken: step1.confirmToken,
      }),
    ).rejects.toThrow(/The requested resource does not exist\. \(schedule missing\)/)
  })

  it('OpenApiError(InvalidParameter) → ToolError', async () => {
    const step1 = (await deleteSchedule.execute(auth, { schedule_id: 's-1' })) as {
      confirmToken: string
    }
    openApiSpy.responseError = new InvalidParameterError('id required')

    await expect(
      deleteSchedule.execute(auth, {
        schedule_id: 's-1',
        confirmToken: step1.confirmToken,
      }),
    ).rejects.toThrow(/The request parameters are invalid\. \(id required\)/)
  })
})

describe('delete_schedule — metadata', () => {
  it('name·description·schemas 노출', () => {
    expect(deleteSchedule.name).toBe('delete_schedule')
    expect(typeof deleteSchedule.description).toBe('string')
    expect(deleteSchedule.description.length).toBeGreaterThan(0)
    expect(deleteSchedule.inputSchema).toBeDefined()
    expect(deleteSchedule.outputSchema).toBeDefined()
  })

  it('description은 2단계 confirm 흐름 안내 포함', () => {
    expect(deleteSchedule.description).toMatch(/confirmToken|two-step|confirm/i)
  })

  it('description은 반복 schedule의 단일 occurrence 삭제는 exclude_schedule_occurrence를 쓰라고 안내 (전체 삭제와 구분)', () => {
    expect(deleteSchedule.description).toMatch(/exclude_schedule_occurrence/i)
  })

  it('description은 recurrence 규칙 자체 변경 케이스는 branch_schedule_repeating을 쓰라고 안내', () => {
    expect(deleteSchedule.description).toMatch(/branch_schedule_repeating/i)
  })
})
