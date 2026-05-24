import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toMcpTool } from '../../src/mcp/toolSchema.js'
import { toMcpInputSchema } from '../../src/mcp/toolSchema.js'
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

  it('discriminatedUnion input — root union(oneOf/anyOf/allOf)이면 throw', () => {
    // Anthropic API는 tools[*].input_schema의 root에 oneOf/allOf/anyOf 불허.
    // MCP는 type:object만 강제하므로 wrap만 해서 통과시키면 다운스트림 LLM API에서 400.
    // ListTools forward되는 모든 turn에서 깨지므로 dev 시점에 즉시 throw로 가드.
    const def = stub({
      inputSchema: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('current') }),
        z.object({ mode: z.literal('range'), lower: z.number(), upper: z.number() }),
      ]),
    }) as AnyToolDefinition

    expect(() => toMcpTool(def)).toThrowError(/root.*(oneOf|anyOf|allOf)/i)
  })

  it('union output — root anyOf이면 throw', () => {
    // outputSchema가 root anyOf이면 toMcpOutputSchema의 type 가드에 걸려 silently
    // undefined 반환 → 클라이언트로 outputSchema 미송신 → LLM이 응답 모양 hint 못 받음.
    // 같은 root-union 회귀를 input/output 양쪽에서 동일 신호로 잡는다.
    const def = stub({
      outputSchema: z.union([
        z.object({ kind: z.literal('a'), aValue: z.string() }),
        z.object({ kind: z.literal('b'), bValue: z.number() }),
      ]),
    }) as AnyToolDefinition

    expect(() => toMcpTool(def)).toThrowError(/root.*(oneOf|anyOf|allOf)/i)
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

  it('intersection output — root allOf이면 throw', () => {
    // z.intersection은 zod v4에서 root allOf을 emit. 동일 root-union 가드에 걸려야.
    const def = stub({
      outputSchema: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
    }) as AnyToolDefinition

    expect(() => toMcpTool(def)).toThrowError(/root.*(oneOf|anyOf|allOf)/i)
  })

  it('name·description 그대로 노출', () => {
    const def = stub({ name: 'do_thing', description: 'does the thing' }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.name).toBe('do_thing')
    expect(tool.description).toBe('does the thing')
  })
})

describe('toMcpInputSchema', () => {
  it('transform 스키마 — { io: "input" }로 pre-transform 노출, throw 안 함', () => {
    // z.toJSONSchema(transform schema)는 기본값에서 throw.
    // ISO입력→timestamp 변환 스키마들이 { io: 'input' }에 의존.
    // 옵션 누락 회귀 감지 테스트.
    const transformSchema = z.object({
      when: z.string().transform((s) => Math.floor(Date.parse(s) / 1000)),
    })

    expect(() => toMcpInputSchema(transformSchema)).not.toThrow()

    const result = toMcpInputSchema(transformSchema)
    expect(result.type).toBe('object')
    expect(result.properties).toBeDefined()
    const whenProp = (result.properties as Record<string, unknown>)['when']
    expect(whenProp).toMatchObject({ type: 'string' })
    // post-transform (number)이 아니라 pre-transform (string) 노출 확인
    expect((whenProp as Record<string, unknown>).type).not.toBe('integer')
    expect((whenProp as Record<string, unknown>).type).not.toBe('number')
  })
})
