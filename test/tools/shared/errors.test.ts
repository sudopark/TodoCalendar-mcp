import { describe, expect, it } from 'vitest'
import {
  InsufficientScopeError,
  InvalidParameterError,
  NotFoundError,
  OpenApiError,
} from '../../../src/openapi/errors.js'
import {
  ToolError,
  naturalizeToolMessage,
  wrapOpenApiError,
} from '../../../src/tools/shared/errors.js'

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

describe('naturalizeToolMessage', () => {
  it('알려진 code + detail — prefix + (detail)', () => {
    expect(naturalizeToolMessage('InvalidParameter', 'name: missing')).toBe(
      'The request parameters are invalid. (name: missing)',
    )
  })

  it('알려진 code + 빈 detail — prefix만', () => {
    expect(naturalizeToolMessage('NotFound', '')).toBe('The requested resource does not exist.')
  })

  it('알려진 code 전부 매핑 (회귀 가드)', () => {
    expect(naturalizeToolMessage('InvalidParameter', 'x')).toMatch(/^The request parameters/)
    expect(naturalizeToolMessage('NotFound', 'x')).toMatch(/^The requested resource/)
    expect(naturalizeToolMessage('InsufficientScope', 'x')).toMatch(/^The auth token/)
  })

  it('알 수 없는 code — detail 그대로 (보강 안 함)', () => {
    expect(naturalizeToolMessage('Timeout', 'after 10s')).toBe('after 10s')
    expect(naturalizeToolMessage('Internal', 'boom')).toBe('boom')
  })

  it('wrapOpenApiError와 동일한 결과 — 일관성 가드', () => {
    // dispatch가 직접 만드는 ToolError(zod 실패)와 wrapOpenApiError가
    // 같은 code에 대해 동일한 메시지 형식을 내야 함.
    const fromDispatch = naturalizeToolMessage('InvalidParameter', 'lower must be a number')
    let fromWrap = ''
    try {
      wrapOpenApiError(new InvalidParameterError('lower must be a number'))
    } catch (e) {
      fromWrap = (e as ToolError).message
    }
    expect(fromDispatch).toBe(fromWrap)
  })
})
