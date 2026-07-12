import { describe, expect, it } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { tools } from '../../src/tools/index.js'

const auth: Auth = { userId: 'u-test', scopes: ['read:calendar'] }
const describeTool = tools['describe_tool']!

describe('describe_tool', () => {
  it('알려진 tool — docs·scopes·input/output JSON Schema 반환', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_expanded_todos' })) as {
      name: string
      docs: string
      scopes: string[]
      input_schema: Record<string, unknown>
      output_schema: Record<string, unknown>
    }

    expect(result.name).toBe('get_expanded_todos')
    expect(result.docs).toBe(tools['get_expanded_todos']!.docs)
    expect(result.scopes).toEqual(['read:calendar'])
    expect(result.input_schema['type']).toBe('object')
    expect(result.output_schema['type']).toBe('object')
  })

  it('array output tool — output_schema는 array root 그대로 (MCP 제약 무관 문서 채널)', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_tags' })) as {
      output_schema: Record<string, unknown>
    }

    expect(result.output_schema['type']).toBe('array')
  })

  it('자기 자신도 describe 가능', async () => {
    const result = (await describeTool.execute(auth, { name: 'describe_tool' })) as { name: string }

    expect(result.name).toBe('describe_tool')
  })

  it('모르는 tool — ToolError 404 NotFound', async () => {
    await expect(describeTool.execute(auth, { name: 'nope' })).rejects.toMatchObject({
      status: 404,
      code: 'NotFound',
    })
  })

  it('input_schema는 pre-transform(ISO 문자열) side — epoch number가 아님', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_schedules' })) as {
      input_schema: { properties: Record<string, Record<string, unknown>> }
    }

    expect(result.input_schema.properties['lower']?.['type']).toBe('string')
  })

  it('output_schema — additionalProperties:false 미포함 (raw passthrough 문서화)', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_event_details' })) as {
      output_schema: Record<string, unknown>
    }

    expect(JSON.stringify(result.output_schema)).not.toContain('"additionalProperties":false')
  })
})
