import jwt from 'jsonwebtoken'
import type { Auth } from '../auth/types.js'
import { requireEnv } from '../internal/env.js'
import { OpenApiError, mapOpenApiError } from './errors.js'
import type { HttpMethod } from './types.js'

const PAT_PREFIX = 'mcp_'

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

export const callOpenApi = async <T>(
  auth: Auth,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> => {
  const baseUrl = requireEnv('OPENAPI_BASE_URL').replace(/\/$/, '')
  const pat = requirePat()
  const userToken = signUserToken(auth)

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${pat}`,
    'x-open-user-token': userToken,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

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
