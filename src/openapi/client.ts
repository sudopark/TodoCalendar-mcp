import jwt from 'jsonwebtoken'
import type { Auth } from '../auth/types.js'
import { requireEnv } from '../internal/env.js'
import { OpenApiError, mapOpenApiError } from './errors.js'
import type { HttpMethod } from './types.js'

const PAT_PREFIX = 'mcp_'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_COUNT = 2
const RETRY_BACKOFF_BASE_MS = 200

const requirePat = (): string => {
  const v = requireEnv('OPENAPI_PAT_MCP')
  if (!v.startsWith(PAT_PREFIX)) {
    throw new Error(`OPENAPI_PAT_MCP must start with "${PAT_PREFIX}"`)
  }
  return v
}

const safeJsonParse = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

const readPositiveIntEnv = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return fallback
  return n
}

export const signUserToken = (auth: Auth): string => {
  return jwt.sign(
    {
      sub: auth.userId,
      scope: ['read:calendar', 'write:calendar'],
    },
    requireEnv('SIGNING_SECRET'),
    { algorithm: 'HS256' },
  )
}

const isAbortError = (err: unknown): boolean => {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

const isRetriableMethod = (method: HttpMethod): boolean =>
  method === 'GET' || method === 'DELETE'

const computeBackoffMs = (attempt: number): number => {
  const exp = RETRY_BACKOFF_BASE_MS * 2 ** attempt
  const jitter = Math.random() * (RETRY_BACKOFF_BASE_MS / 4)
  return exp + jitter
}

const internals = {
  sleep: (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
}

export const __callOpenApiInternalsForTest: typeof internals | undefined =
  process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST) ? internals : undefined

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const callOpenApi = async <T>(
  auth: Auth,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> => {
  const baseUrl = requireEnv('OPENAPI_BASE_URL').replace(/\/$/, '')
  const pat = requirePat()
  const userToken = signUserToken(auth)
  const timeoutMs = readPositiveIntEnv('OPENAPI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
  const retryCount = readPositiveIntEnv('OPENAPI_RETRY_COUNT', DEFAULT_RETRY_COUNT)

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${pat}`,
    'x-open-user-token': userToken,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const init: RequestInit = {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  const canRetry = isRetriableMethod(method)
  const maxAttempts = canRetry ? retryCount + 1 : 1

  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetchWithTimeout(url, init, timeoutMs)
    } catch (err) {
      if (isAbortError(err)) {
        throw new OpenApiError(
          0,
          'Timeout',
          `openAPI request timed out after ${timeoutMs}ms`,
        )
      }
      lastError = err
      if (!canRetry || attempt === maxAttempts - 1) throw err
      await internals.sleep(computeBackoffMs(attempt))
      continue
    }

    if (res.status >= 500 && canRetry && attempt < maxAttempts - 1) {
      lastError = res
      await internals.sleep(computeBackoffMs(attempt))
      continue
    }

    const text = await res.text()
    const parsed: unknown = text ? safeJsonParse(text) : undefined

    if (!res.ok) {
      throw mapOpenApiError(res.status, parsed)
    }
    if (parsed === undefined) {
      throw new OpenApiError(res.status, 'EmptyBody', `openAPI ${res.status} returned empty body`)
    }
    return parsed as T
  }

  throw lastError ?? new OpenApiError(0, 'Unknown', 'openAPI request failed after retries')
}
