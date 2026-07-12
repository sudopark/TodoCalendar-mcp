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

  it('outputSchema 미송신 — 문서 채널은 describe_tool (#73)', () => {
    const def = stub({
      outputSchema: z.object({ a: z.string() }),
    }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.outputSchema).toBeUndefined()
  })

  it('name·description 그대로 노출', () => {
    const def = stub({ name: 'do_thing', description: 'does the thing' }) as AnyToolDefinition

    const tool = toMcpTool(def)
    expect(tool.name).toBe('do_thing')
    expect(tool.description).toBe('does the thing')
  })
})
