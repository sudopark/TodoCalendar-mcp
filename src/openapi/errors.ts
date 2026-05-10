import type { OpenApiErrorBody } from './types.js'

export class OpenApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'OpenApiError'
    this.status = status
    this.code = code
  }
}

export class InvalidParameterError extends OpenApiError {
  constructor(message: string) {
    super(400, 'InvalidParameter', message)
    this.name = 'InvalidParameterError'
  }
}

export class InsufficientScopeError extends OpenApiError {
  constructor(message: string) {
    super(403, 'InsufficientScope', message)
    this.name = 'InsufficientScopeError'
  }
}

export class NotFoundError extends OpenApiError {
  constructor(message: string) {
    super(404, 'NotFound', message)
    this.name = 'NotFoundError'
  }
}

const isErrorBody = (v: unknown): v is OpenApiErrorBody => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.status === 'number' && typeof o.code === 'string' && typeof o.message === 'string'
  )
}

export const mapOpenApiError = (status: number, body: unknown): OpenApiError => {
  if (isErrorBody(body)) {
    switch (body.code) {
      case 'InvalidParameter':
        return new InvalidParameterError(body.message)
      case 'InsufficientScope':
        return new InsufficientScopeError(body.message)
      case 'NotFound':
        return new NotFoundError(body.message)
      default:
        return new OpenApiError(body.status, body.code, body.message)
    }
  }
  return new OpenApiError(status, 'Unknown', `openAPI ${status} (non-standard body)`)
}
