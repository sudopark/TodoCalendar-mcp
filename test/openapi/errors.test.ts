import { describe, expect, it } from 'vitest'
import {
  InsufficientScopeError,
  InvalidParameterError,
  NotFoundError,
  OpenApiError,
  mapOpenApiError,
} from '../../src/openapi/errors.js'

describe('mapOpenApiError', () => {
  it('400 InvalidParameter → InvalidParameterError', () => {
    const err = mapOpenApiError(400, {
      status: 400,
      code: 'InvalidParameter',
      message: 'bad input',
    })
    expect(err).toBeInstanceOf(InvalidParameterError)
    expect(err.code).toBe('InvalidParameter')
    expect(err.status).toBe(400)
    expect(err.message).toBe('bad input')
  })

  it('403 InsufficientScope → InsufficientScopeError', () => {
    const err = mapOpenApiError(403, {
      status: 403,
      code: 'InsufficientScope',
      message: 'no scope',
    })
    expect(err).toBeInstanceOf(InsufficientScopeError)
    expect(err.code).toBe('InsufficientScope')
  })

  it('404 NotFound → NotFoundError', () => {
    const err = mapOpenApiError(404, {
      status: 404,
      code: 'NotFound',
      message: 'gone',
    })
    expect(err).toBeInstanceOf(NotFoundError)
  })

  it('알 수 없는 code — OpenApiError로 폴백', () => {
    const err = mapOpenApiError(409, { status: 409, code: 'Conflict', message: 'dup' })
    expect(err).toBeInstanceOf(OpenApiError)
    expect(err).not.toBeInstanceOf(InvalidParameterError)
    expect(err.code).toBe('Conflict')
  })

  it('비표준 4xx body — Unknown으로 안전 폴백', () => {
    const err = mapOpenApiError(502, 'i am a teapot')
    expect(err).toBeInstanceOf(OpenApiError)
    expect(err.status).toBe(502)
    expect(err.code).toBe('Unknown')
  })

  it('null body — Unknown 폴백', () => {
    const err = mapOpenApiError(500, null)
    expect(err).toBeInstanceOf(OpenApiError)
    expect(err.code).toBe('Unknown')
  })
})
