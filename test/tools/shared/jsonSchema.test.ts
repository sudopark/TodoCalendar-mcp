import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toDocJsonSchema, toInputJsonSchema } from '../../../src/tools/shared/jsonSchema.js'

describe('toInputJsonSchema', () => {
  it('일반 object — type: object 그대로, $schema 제거', () => {
    const json = toInputJsonSchema(z.object({ lower: z.number(), upper: z.number() }))

    expect(json['$schema']).toBeUndefined()
    expect(json).toMatchObject({
      type: 'object',
      properties: { lower: { type: 'number' }, upper: { type: 'number' } },
      required: ['lower', 'upper'],
    })
  })

  it('transform 스키마 — { io: "input" }로 pre-transform side 노출, throw 안 함', () => {
    // z.toJSONSchema(transform schema)는 기본값에서 throw.
    // ISO입력→timestamp 변환 스키마들이 { io: 'input' }에 의존. 옵션 누락 회귀 감지.
    const transformSchema = z.object({
      when: z.string().transform((s) => Math.floor(Date.parse(s) / 1000)),
    })

    expect(() => toInputJsonSchema(transformSchema)).not.toThrow()

    const whenProp = (toInputJsonSchema(transformSchema)['properties'] as Record<string, unknown>)[
      'when'
    ]
    // post-transform (number)이 아니라 pre-transform (string) 노출 확인
    expect(whenProp).toMatchObject({ type: 'string' })
  })

  it('root oneOf/anyOf/allOf — throw (Anthropic API가 tools[*].input_schema에서 거부)', () => {
    const union = z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('current') }),
      z.object({ mode: z.literal('range'), lower: z.number(), upper: z.number() }),
    ])

    expect(() => toInputJsonSchema(union)).toThrowError(/root.*(oneOf|anyOf|allOf)/i)
  })
})

describe('toDocJsonSchema', () => {
  it('additionalProperties:false → {} 완화 (raw passthrough 문서화)', () => {
    const json = toDocJsonSchema(z.strictObject({ a: z.string() }))

    expect(json['additionalProperties']).toEqual({})
  })

  it('array root 허용 — MCP outputSchema 제약과 무관한 문서 채널', () => {
    const json = toDocJsonSchema(z.array(z.object({ a: z.string() })))

    expect(json['type']).toBe('array')
  })

  it('중첩 object·배열 안 object의 additionalProperties도 모두 완화', () => {
    const json = toDocJsonSchema(
      z.object({
        meta: z.object({ source: z.string() }),
        items: z.array(z.object({ id: z.string() })),
      }),
    )

    expect(JSON.stringify(json)).not.toContain('"additionalProperties":false')
  })

  it('intersection의 unevaluatedProperties:false도 완화', () => {
    const json = toDocJsonSchema(
      z.object({
        merged: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      }),
    )

    expect(JSON.stringify(json)).not.toContain('"unevaluatedProperties":false')
  })

  it('$schema 제거', () => {
    const json = toDocJsonSchema(z.object({ a: z.string() }))

    expect(json['$schema']).toBeUndefined()
  })
})
