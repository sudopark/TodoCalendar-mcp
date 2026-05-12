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

// code → 자연어 prefix. detail이 있으면 `${prefix} (${detail})`, 없으면 prefix만.
// dispatch가 직접 만드는 ToolError(zod 실패 등)와 wrapOpenApiError가 같은 helper를
// 거쳐야 caller가 동일 code에 대해 일관된 메시지 형식을 받는다.
export const naturalizeToolMessage = (code: string, detail: string): string => {
  const prefix = NATURAL[code]
  if (prefix === undefined) return detail
  return detail ? `${prefix} (${detail})` : prefix
}

const naturalize = (e: OpenApiError): string => naturalizeToolMessage(e.code, e.message)

export const wrapOpenApiError = (e: unknown): never => {
  if (e instanceof OpenApiError) {
    throw new ToolError(e.status, e.code, naturalize(e))
  }
  throw e
}
