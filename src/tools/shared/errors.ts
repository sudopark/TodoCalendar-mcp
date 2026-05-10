import { OpenApiError } from '../../openapi/errors.js'

const NATURAL: Record<string, string> = {
  InvalidParameter: 'The request parameters are invalid.',
  NotFound: 'The requested resource does not exist.',
  InsufficientScope: 'The auth token lacks the required scope.',
}

export class ToolError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
    this.status = status
  }
}

const naturalize = (e: OpenApiError): string => {
  const prefix = NATURAL[e.code]
  if (prefix === undefined) return e.message
  return e.message ? `${prefix} (${e.message})` : prefix
}

export const wrapOpenApiError = (e: unknown): never => {
  if (e instanceof OpenApiError) {
    throw new ToolError(e.status, e.code, naturalize(e))
  }
  throw e
}
