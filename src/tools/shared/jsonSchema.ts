import { z } from 'zod'

type JsonObject = Record<string, unknown>

const stripMeta = (json: JsonObject): JsonObject => {
  const { $schema, ...rest } = json
  void $schema
  return rest
}

// Raw passthrough: openAPI may add fields beyond what zod declares — schemas shown to
// the LLM must not claim `additionalProperties: false` (nor the equivalent
// `unevaluatedProperties: false` that JSON Schema 2020-12 emits for some compositional
// shapes — allOf/intersection branches). Recursively relax both to `{}` (allow anything).
const relaxAdditional = (json: unknown): unknown => {
  if (Array.isArray(json)) return json.map(relaxAdditional)
  if (typeof json !== 'object' || json === null) return json
  const out: JsonObject = {}
  for (const [k, v] of Object.entries(json)) {
    if ((k === 'additionalProperties' || k === 'unevaluatedProperties') && v === false) {
      out[k] = {}
    } else out[k] = relaxAdditional(v)
  }
  return out
}

const ROOT_UNION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const

// Anthropic API: tools[*].input_schema root에 oneOf/allOf/anyOf 불허 — ListTools forward
// 되는 모든 turn에서 400으로 세션 전체 먹통. dev 시점에 throw로 회귀 차단.
const assertNoRootUnion = (json: JsonObject): void => {
  const present = ROOT_UNION_KEYS.filter((k) => k in json)
  if (present.length === 0) return
  throw new Error(
    `tool inputSchema must not have root ${present.join('/')} — Anthropic API rejects ` +
      `tools[*].input_schema with top-level oneOf/anyOf/allOf. Flatten to a single object schema.`,
  )
}

// io: 'input' — transform schemas expose pre-transform (input) side for JSON Schema.
// Required because input schemas may contain ISO→ts transforms.
export const toInputJsonSchema = (zod: z.ZodType): JsonObject => {
  const json = stripMeta(z.toJSONSchema(zod, { io: 'input' }) as JsonObject)
  assertNoRootUnion(json)
  return json
}

// describe_tool 문서 채널용 변환 — MCP tools/list outputSchema 제약(root object)과 무관하므로
// array root도 그대로 노출. 검증에 쓰이지 않는 순수 문서 (#73).
export const toDocJsonSchema = (zod: z.ZodType): JsonObject =>
  relaxAdditional(stripMeta(z.toJSONSchema(zod) as JsonObject)) as JsonObject
