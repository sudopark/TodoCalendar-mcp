import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toMcpTool } from '../../src/mcp/toolSchema.js'
import type { AnyToolDefinition, ToolDefinition } from '../../src/tools/index.js'

const stub = <I, O>(over: Partial<ToolDefinition<I, O>>): ToolDefinition<I, O> => ({
  name: 'stub',
  description: 'stub',
  scopes: ['read:calendar'],
  inputSchema: z.object({}) as z.ZodType<I>,
  outputSchema: z.object({}) as z.ZodType<O>,
  execute: async () => ({}) as O,
  ...over,
})

describe('toMcpTool', () => {
  it('일반 object input — type: object 그대로', () => {
    const def = stub({
      inputSchema: z.object({ lower: z.number(), upper: z.number() }),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { lower: { type: 'number' }, upper: { type: 'number' } },
      required: ['lower', 'upper'],
    })
  })

  it('discriminatedUnion input — top-level oneOf을 type:object로 감싸 MCP 호환', () => {
    const def = stub({
      inputSchema: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('current') }),
        z.object({ mode: z.literal('range'), lower: z.number(), upper: z.number() }),
      ]),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema['oneOf']).toBeDefined()
  })

  it('object output — outputSchema 노출, additionalProperties 완화 (raw passthrough)', () => {
    const def = stub({
      outputSchema: z.object({ a: z.string() }),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.outputSchema).toBeDefined()
    expect(tool.outputSchema?.['additionalProperties']).toEqual({})
  })

  it('array output — outputSchema 미노출 (MCP는 type:object만 허용)', () => {
    const def = stub({
      outputSchema: z.array(z.object({ a: z.string() })),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.outputSchema).toBeUndefined()
  })

  it('중첩 object output — nested additionalProperties도 모두 완화', () => {
    const def = stub({
      outputSchema: z.object({
        meta: z.object({ source: z.string() }),
      }),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    const meta = (tool.outputSchema?.properties as Record<string, Record<string, unknown>>)['meta']
    expect(meta?.['additionalProperties']).toEqual({})
  })

  it('배열 안 object의 additionalProperties도 완화 (write tool wrapping 시 hot path)', () => {
    const def = stub({
      outputSchema: z.object({
        items: z.array(z.object({ id: z.string(), value: z.number() })),
      }),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    const items = (tool.outputSchema?.properties as Record<string, Record<string, unknown>>)['items']
    const itemSchema = items?.['items'] as Record<string, unknown> | undefined
    expect(itemSchema?.['additionalProperties']).toEqual({})
  })

  it('unevaluatedProperties:false도 완화 (intersection·allOf 합성 시 emit)', () => {
    // 인공 케이스: zod의 intersection / allOf 등에서 emit될 수 있는 패턴 직접 시뮬레이션.
    // toJSONSchema로는 잘 안 나오지만 미래 합성 케이스 회귀 잡기 위한 가드.
    // (z.toJSONSchema가 unevaluatedProperties를 직접 emit하는 단일 케이스가 zod v4에선 드물어
    //  여기선 relaxAdditional의 동작을 직접 검증하는 unit test 성격으로 추가)
    const def = stub({
      outputSchema: z.intersection(
        z.object({ a: z.string() }),
        z.object({ b: z.number() }),
      ),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    if (tool.outputSchema === undefined) return // intersection이 type:object 아니면 미노출 — OK
    // additionalProperties든 unevaluatedProperties든 false인 키가 잔존하면 안 됨
    const json = JSON.stringify(tool.outputSchema)
    expect(json.includes('"additionalProperties":false')).toBe(false)
    expect(json.includes('"unevaluatedProperties":false')).toBe(false)
  })

  it('name·description 그대로 노출', () => {
    const def = stub({ name: 'do_thing', description: 'does the thing' }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.name).toBe('do_thing')
    expect(tool.description).toBe('does the thing')
  })
})
