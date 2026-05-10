import { describe, expect, it } from 'vitest'
import {
  InsufficientScopeError,
  InvalidParameterError,
  NotFoundError,
  OpenApiError,
} from '../../../src/openapi/errors.js'
import { ToolError, wrapOpenApiError } from '../../../src/tools/shared/errors.js'

describe('wrapOpenApiError', () => {
  it('InvalidParameter — 영어 자연어 prefix + 원본 message 보존', () => {
    expect(() =>
      wrapOpenApiError(new InvalidParameterError('lower must be a number')),
    ).toThrow(
      expect.objectContaining({
        name: 'ToolError',
        code: 'InvalidParameter',
        status: 400,
        message: 'The request parameters are invalid. (lower must be a number)',
      }) as Partial<ToolError>,
    )
  })

  it('NotFound — prefix만 (server message empty)', () => {
    expect(() => wrapOpenApiError(new NotFoundError(''))).toThrow(
      expect.objectContaining({
        code: 'NotFound',
        status: 404,
        message: 'The requested resource does not exist.',
      }) as Partial<ToolError>,
    )
  })

  it('InsufficientScope — 403 + scope 메시지', () => {
    expect(() => wrapOpenApiError(new InsufficientScopeError('write:calendar required'))).toThrow(
      expect.objectContaining({
        code: 'InsufficientScope',
        status: 403,
        message: 'The auth token lacks the required scope. (write:calendar required)',
      }) as Partial<ToolError>,
    )
  })

  it('알 수 없는 code — 원본 메시지 그대로 (보강 안 함)', () => {
    expect(() => wrapOpenApiError(new OpenApiError(500, 'InternalError', 'db down'))).toThrow(
      expect.objectContaining({
        code: 'InternalError',
        status: 500,
        message: 'db down',
      }) as Partial<ToolError>,
    )
  })

  it('OpenApiError 아닌 에러는 그대로 재throw', () => {
    const generic = new TypeError('boom')
    expect(() => wrapOpenApiError(generic)).toThrow(generic)
  })
})
