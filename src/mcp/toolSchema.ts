import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AnyToolDefinition } from '../tools/index.js'

type InputSchema = Tool['inputSchema']
type OutputSchema = NonNullable<Tool['outputSchema']>

const stripMeta = (json: Record<string, unknown>): Record<string, unknown> => {
  const { $schema, ...rest } = json
  void $schema
  return rest
}

// Raw passthrough: openAPI may add fields beyond what zod declares. Client.callTool
// validates structuredContent against outputSchema strictly — `additionalProperties: false`
// (and the equivalent `unevaluatedProperties: false` that JSON Schema 2020-12 emits for
// some compositional shapes — allOf/intersection branches) would reject extras and break
// round-trip. Recursively relax both to `{}` (allow anything).
const relaxAdditional = (json: unknown): unknown => {
  if (Array.isArray(json)) return json.map(relaxAdditional)
  if (typeof json !== 'object' || json === null) return json
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(json)) {
    if ((k === 'additionalProperties' || k === 'unevaluatedProperties') && v === false) {
      out[k] = {}
    } else out[k] = relaxAdditional(v)
  }
  return out
}

const ROOT_UNION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const

// Anthropic API: tools[*].input_schema root에 oneOf/allOf/anyOf 불허 — ListTools forward
// 되는 모든 turn에서 400으로 세션 전체 먹통. MCP outputSchema도 root union이면 type 가드에
// 걸려 silently drop되어 LLM hint 손실. 두 회귀를 dev 시점에 동일 신호로 throw.
const assertNoRootUnion = (json: Record<string, unknown>, role: 'input' | 'output'): void => {
  const present = ROOT_UNION_KEYS.filter((k) => k in json)
  if (present.length === 0) return
  throw new Error(
    `tool ${role}Schema must not have root ${present.join('/')} — Anthropic API rejects ` +
      `tools[*].input_schema with top-level oneOf/anyOf/allOf, and MCP silently drops ` +
      `root-union outputSchema. Flatten to a single object schema.`,
  )
}

const toMcpInputSchema = (zod: z.ZodType): InputSchema => {
  const json = stripMeta(z.toJSONSchema(zod) as Record<string, unknown>)
  assertNoRootUnion(json, 'input')
  return json as InputSchema
}

const toMcpOutputSchema = (zod: z.ZodType): OutputSchema | undefined => {
  const json = stripMeta(z.toJSONSchema(zod) as Record<string, unknown>)
  assertNoRootUnion(json, 'output')
  // MCP spec: outputSchema root MUST be `type: 'object'`. Array-returning tools
  // (get_todos / get_schedules / get_tags) skip outputSchema — text payload still
  // carries the raw JSON, and tool description documents the shape.
  if (json.type !== 'object') return undefined
  return relaxAdditional(json) as OutputSchema
}

export const toMcpTool = (def: AnyToolDefinition): Tool => {
  const tool: Tool = {
    name: def.name,
    description: def.description,
    inputSchema: toMcpInputSchema(def.inputSchema),
  }
  const output = toMcpOutputSchema(def.outputSchema)
  if (output !== undefined) tool.outputSchema = output
  return tool
}
