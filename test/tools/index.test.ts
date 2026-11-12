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
      'describe_tool',
      'exclude_schedule_occurrence',
      'get_done_todos',
      'get_event_details',
      'get_expanded_schedules',
      'get_expanded_todos',
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
      expect(typeof tool.docs).toBe('string')
      expect(tool.docs.length).toBeGreaterThan(0)
      // description은 탐색용 요약 — docs(전체 가이드)보다 길 수 없다 (#73)
      expect(tool.description.length).toBeLessThanOrEqual(tool.docs.length)
      expect(Array.isArray(tool.scopes)).toBe(true)
      expect(tool.scopes.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('scope 매핑 — get_*와 describe_tool(메타, 무변이)은 read:calendar, 나머지는 write:calendar (set_foremost_event만 둘 다)', () => {
    for (const [key, tool] of Object.entries(tools)) {
      // set_foremost_event만 예외 — pin 전에 대상 종류를 단건 조회로 판별하므로 read도 함께 요구한다.
      const expected =
        key === 'describe_tool' || key.startsWith('get_')
          ? ['read:calendar']
          : key === 'set_foremost_event'
            ? ['read:calendar', 'write:calendar']
            : ['write:calendar']
      expect(tool.scopes).toEqual(expected)
    }
  })

  // Claude Connectors 디렉토리 제출 요건 (#72) — "every tool includes a `title` and the
  // applicable `readOnlyHint` or `destructiveHint`". 리뷰어가 이 값으로 위험도를 판단한다.
  it('annotations — 전 tool에 사람이 읽는 title', () => {
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.annotations.title, key).toBeTypeOf('string')
      expect(tool.annotations.title.length, key).toBeGreaterThan(0)
    }
  })

  it('annotations — 조회 tool은 readOnlyHint true, 나머지는 false', () => {
    for (const [key, tool] of Object.entries(tools)) {
      const isRead = key === 'describe_tool' || key.startsWith('get_')
      expect(tool.annotations.readOnlyHint, key).toBe(isRead)
    }
  })

  // 스펙상 destructiveHint는 readOnlyHint === false일 때만 의미가 있다. 그리고 기본값이
  // true라서 비파괴 write에도 false를 명시해야 create_*가 파괴적으로 읽히지 않는다.
  it('annotations — destructiveHint는 write tool에만, 전원 명시', () => {
    for (const [key, tool] of Object.entries(tools)) {
      const isRead = key === 'describe_tool' || key.startsWith('get_')
      if (isRead) expect(tool.annotations.destructiveHint, key).toBeUndefined()
      else expect(tool.annotations.destructiveHint, key).toBeTypeOf('boolean')
    }
  })

  // 대상 또는 그 회차 자체가 사라지는 변경만 파괴적으로 본다. 필드만 바뀌고 대상이 남는
  // 변경(update_*, set_*, complete/revert)은 비파괴 — 전부 파괴로 올리면 클라이언트가
  // 평범한 수정마다 확인을 받게 돼 신호가 죽는다.
  it('annotations — destructiveHint true 목록', () => {
    const destructive = Object.entries(tools)
      .filter(([, tool]) => tool.annotations.destructiveHint === true)
      .map(([key]) => key)
      .sort()
    expect(destructive).toEqual([
      'branch_schedule_repeating',
      'clear_foremost_event',
      'delete_done_todo',
      'delete_event_detail',
      'delete_schedule',
      'delete_tag',
      'delete_todo',
      'exclude_schedule_occurrence',
      'replace_schedule_occurrence',
      'replace_todo',
    ])
  })

  it('frozen — 런타임에 tool 추가/교체 불가', () => {
    expect(Object.isFrozen(tools)).toBe(true)
  })
})
