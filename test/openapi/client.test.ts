import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callOpenApi, signUserToken } from '../../src/openapi/client.js'
import {
  InsufficientScopeError,
  InvalidParameterError,
  NotFoundError,
  OpenApiError,
} from '../../src/openapi/errors.js'

const SIGNING = 'test-signing-secret'
const PAT = 'mcp_test'
const BASE = 'https://api.example.com'

const mockOk = (body: unknown = {}, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type FetchCall = [input: string, init: RequestInit]
interface FetchSpyShape {
  mock: { calls: unknown[][] }
}

const getCall = (spy: FetchSpyShape): FetchCall => {
  const call = spy.mock.calls[0]
  if (!call) throw new Error('fetch not called')
  return [call[0] as string, call[1] as RequestInit]
}

const getHeaders = (spy: FetchSpyShape): Record<string, string> =>
  getCall(spy)[1].headers as Record<string, string>

beforeEach(() => {
  vi.stubEnv('OPENAPI_BASE_URL', BASE)
  vi.stubEnv('OPENAPI_PAT_MCP', PAT)
  vi.stubEnv('SIGNING_SECRET', SIGNING)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('signUserToken', () => {
  it('payload — sub + scope claim 포함, HS256 서명', () => {
    const token = signUserToken({ userId: 'user-1', scopes: ['read:calendar', 'write:calendar'] })
    const decoded = jwt.verify(token, SIGNING, { algorithms: ['HS256'] }) as jwt.JwtPayload
    expect(decoded.sub).toBe('user-1')
    expect(decoded.scope).toEqual(['read:calendar', 'write:calendar'])
  })

  it('SIGNING_SECRET 누락 시 throw', () => {
    vi.stubEnv('SIGNING_SECRET', '')
    expect(() => signUserToken({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] })).toThrow(/SIGNING_SECRET/)
  })
})

describe('callOpenApi — 헤더 주입', () => {
  it('Authorization + x-open-user-token 동시 주입', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk({ ok: true }))
    await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/v2/open/todos')

    const headers = getHeaders(fetchSpy)
    expect(headers.Authorization).toBe(`Bearer ${PAT}`)
    expect(headers['x-open-user-token']).toBeTruthy()

    const decoded = jwt.verify(headers['x-open-user-token']!, SIGNING, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload
    expect(decoded.sub).toBe('u')
    expect(decoded.scope).toEqual(['read:calendar', 'write:calendar'])
  })

  it('GET — body / Content-Type 없음', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk())
    await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/v2/open/todos')

    const [, init] = getCall(fetchSpy)
    expect(init.body).toBeUndefined()
    expect(getHeaders(fetchSpy)['Content-Type']).toBeUndefined()
  })

  it('POST + body — JSON 직렬화 + Content-Type 주입', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk())
    await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'POST', '/v2/open/todos', { name: 'x' })

    const [, init] = getCall(fetchSpy)
    expect(init.body).toBe(JSON.stringify({ name: 'x' }))
    expect(getHeaders(fetchSpy)['Content-Type']).toBe('application/json')
  })
})

describe('callOpenApi — URL 조립', () => {
  it('base URL 트레일링 슬래시 정규화', async () => {
    vi.stubEnv('OPENAPI_BASE_URL', `${BASE}/`)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk())
    await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/v2/open/todos')

    expect(getCall(fetchSpy)[0]).toBe(`${BASE}/v2/open/todos`)
  })

  it('path 선행 슬래시 누락도 허용', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk())
    await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', 'v2/open/todos')

    expect(getCall(fetchSpy)[0]).toBe(`${BASE}/v2/open/todos`)
  })
})

describe('callOpenApi — 응답 처리', () => {
  it('성공 응답 — JSON 파싱해서 반환', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOk({ id: 'a', name: 'x' }))
    const res = await callOpenApi<{ id: string; name: string }>(
      { userId: 'u', scopes: ['read:calendar', 'write:calendar'] },
      'GET',
      '/v2/open/todos/a',
    )
    expect(res).toEqual({ id: 'a', name: 'x' })
  })

  it('400 → InvalidParameterError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 400, code: 'InvalidParameter', message: 'bad' }), {
        status: 400,
      }),
    )
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toBeInstanceOf(
      InvalidParameterError,
    )
  })

  it('403 → InsufficientScopeError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ status: 403, code: 'InsufficientScope', message: 'no scope' }),
        { status: 403 },
      ),
    )
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toBeInstanceOf(
      InsufficientScopeError,
    )
  })

  it('404 → NotFoundError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 404, code: 'NotFound', message: 'gone' }), {
        status: 404,
      }),
    )
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('비표준 4xx body (HTML 등) — OpenApiError 폴백', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>500</html>', { status: 502 }),
    )
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toMatchObject({
      status: 502,
      code: 'Unknown',
    })
  })

  it('빈 body 4xx — OpenApiError 폴백', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    const err = await callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OpenApiError)
    expect((err as OpenApiError).status).toBe(500)
  })

  it('2xx + 빈 body — EmptyBody 에러로 throw (success body invariant 강제)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'DELETE', '/x')).rejects.toMatchObject({
      status: 200,
      code: 'EmptyBody',
    })
  })

  it('네트워크 에러 (fetch reject) — raw error 그대로 propagate', async () => {
    const networkErr = new TypeError('fetch failed')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkErr)
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toBe(networkErr)
  })
})

describe('callOpenApi — env 검증', () => {
  it('OPENAPI_BASE_URL 누락 시 throw', async () => {
    vi.stubEnv('OPENAPI_BASE_URL', '')
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toThrow(/OPENAPI_BASE_URL/)
  })

  it('OPENAPI_PAT_MCP 누락 시 throw', async () => {
    vi.stubEnv('OPENAPI_PAT_MCP', '')
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toThrow(/OPENAPI_PAT_MCP/)
  })

  it('OPENAPI_PAT_MCP가 mcp_ prefix 아니면 throw', async () => {
    vi.stubEnv('OPENAPI_PAT_MCP', 'wrong_secret')
    await expect(callOpenApi({ userId: 'u', scopes: ['read:calendar', 'write:calendar'] }, 'GET', '/x')).rejects.toThrow(/mcp_/)
  })
})
