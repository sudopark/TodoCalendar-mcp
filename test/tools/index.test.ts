import { describe, expect, it } from 'vitest'
import { tools } from '../../src/tools/index.js'

describe('tools registry', () => {
  it('등록된 tool 모두 — 키는 각 tool의 name과 일치', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'branch_schedule_repeating',
      'clear_foremost_event',
      'complete_todo',
      'create_schedule',
      'create_tag',
      'create_todo',
      'delete_done_todo',
      'delete_event_detail',
      'delete_schedule',
      'delete_tag',
      'delete_todo',
      'exclude_schedule_occurrence',
      'get_done_todos',
      'get_event_details',
      'get_foremost_event',
      'get_schedules',
      'get_tags',
      'get_todos',
      'replace_schedule_occurrence',
      'replace_todo',
      'revert_done_todo',
      'set_event_detail',
      'set_foremost_event',
      'update_done_todo',
      'update_schedule',
      'update_tag',
      'update_todo',
    ])
  })

  it('각 entry는 ToolDefinition 모양 — name·description·scopes·schemas·execute', () => {
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.name).toBe(key)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(Array.isArray(tool.scopes)).toBe(true)
      expect(tool.scopes.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('scope 매핑 — get_* tool은 read:calendar, 나머지는 write:calendar', () => {
    for (const [key, tool] of Object.entries(tools)) {
      const expected = key.startsWith('get_') ? 'read:calendar' : 'write:calendar'
      expect(tool.scopes).toEqual([expected])
    }
  })

  it('frozen — 런타임에 tool 추가/교체 불가', () => {
    expect(Object.isFrozen(tools)).toBe(true)
  })
})
