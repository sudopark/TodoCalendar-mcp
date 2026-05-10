import { describe, expect, it } from 'vitest'
import { tools } from '../../src/tools/index.js'

describe('tools registry', () => {
  it('등록된 tool 모두 — 키는 각 tool의 name과 일치', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_tag',
      'get_done_todos',
      'get_event_details',
      'get_schedules',
      'get_tags',
      'get_todos',
    ])
  })

  it('각 entry는 ToolDefinition 모양 — name·description·schemas·execute', () => {
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.name).toBe(key)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('frozen — 런타임에 tool 추가/교체 불가', () => {
    expect(Object.isFrozen(tools)).toBe(true)
  })
})
