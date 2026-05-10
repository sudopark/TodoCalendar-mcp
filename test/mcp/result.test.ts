import { describe, expect, it } from 'vitest'
import { buildCallToolResult, buildErrorResult } from '../../src/mcp/result.js'
import { ToolError } from '../../src/tools/shared/errors.js'

describe('buildCallToolResult', () => {
  it('object 결과 — content text + structuredContent 모두 포함', () => {
    const raw = { uuid: 'e-1', userId: 'u-1', place: 'home' }
    const result = buildCallToolResult(raw)

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(raw) }])
    expect(result.structuredContent).toEqual(raw)
  })

  it('array 결과 — content text만, structuredContent 생략 (MCP spec: object only)', () => {
    const raw = [{ uuid: 't-1' }, { uuid: 't-2' }]
    const result = buildCallToolResult(raw)

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(raw) }])
    expect(result.structuredContent).toBeUndefined()
  })

  it('null/primitive 결과 — text만', () => {
    const result = buildCallToolResult(null)

    expect(result.content).toEqual([{ type: 'text', text: 'null' }])
    expect(result.structuredContent).toBeUndefined()
  })

  it('object 결과 — userId 같은 raw 필드 보존 (passthrough)', () => {
    const raw = { uuid: 't-1', userId: 'u-1', extraField: 'ignored?' }
    const result = buildCallToolResult(raw)

    expect(result.structuredContent).toEqual(raw)
  })
})

describe('buildErrorResult', () => {
  it('ToolError — _meta에 code/status, text에는 {code,status,message} JSON', () => {
    const result = buildErrorResult(
      new ToolError(404, 'NotFound', 'The requested resource does not exist.'),
    )

    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]?.text
    expect(text).toBeDefined()
    expect(JSON.parse(text!)).toEqual({
      code: 'NotFound',
      status: 404,
      message: 'The requested resource does not exist.',
    })
    expect(result._meta).toEqual({ code: 'NotFound', status: 404 })
  })

  it('일반 Error — text는 {code:"Internal", message} JSON, _meta 없음', () => {
    const result = buildErrorResult(new Error('boom'))

    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]?.text
    expect(JSON.parse(text!)).toEqual({ code: 'Internal', message: 'boom' })
    expect(result._meta).toBeUndefined()
  })

  it('non-Error throw — String() 변환 후 동일 JSON 모양', () => {
    const result = buildErrorResult('something went wrong')

    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]?.text
    expect(JSON.parse(text!)).toEqual({ code: 'Internal', message: 'something went wrong' })
  })
})
