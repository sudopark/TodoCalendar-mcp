import type { IncomingHttpHeaders } from 'node:http'
import type { Auth } from '../auth/types.js'

export const DEV_USER_ID_HEADER = 'x-dev-user-id' as const

export class AuthRequiredError extends Error {
  override readonly name = 'AuthRequiredError'
  constructor(message: string) {
    super(message)
  }
}

const headerValue = (headers: IncomingHttpHeaders, key: string): string | undefined => {
  const raw = headers[key.toLowerCase()]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

export const extractDevAuth = (headers: IncomingHttpHeaders): Auth => {
  const userId = headerValue(headers, DEV_USER_ID_HEADER)?.trim()
  if (userId === undefined || userId === '') {
    throw new AuthRequiredError(`${DEV_USER_ID_HEADER} header is required`)
  }
  return { userId }
}
