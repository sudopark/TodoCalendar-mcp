import { describe, expect, it } from 'vitest'
import { notificationOptionsInputSchema } from '../../../src/tools/shared/schemas.js'

describe('notificationOptionsInputSchema', () => {
  it.each([
    [{ type_text: 'at_time' }],
    [{ type_text: 'before', before_seconds: 600 }],
    [{ type_text: 'allDay9AM' }],
    [{ type_text: 'allDay12AM' }],
    [{ type_text: 'allDay9AMBefore', before_seconds: 86400 }],
    [{ type_text: 'custom', custom_components: { year: 2026, month: 11, day: 20, hour: 9, minute: 30 } }],
    [
      {
        type_text: 'custom',
        custom_components: { year: 2026, month: 11, day: 20, hour: 9, minute: 30, second: 0 },
      },
    ],
  ])('type_text 별 모양 통과 — %o', (option) => {
    expect(notificationOptionsInputSchema.parse([option])).toEqual([option])
  })

  it('여러 옵션을 한 배열로', () => {
    const options = [{ type_text: 'at_time' }, { type_text: 'before', before_seconds: 300 }]
    expect(notificationOptionsInputSchema.parse(options)).toEqual(options)
  })

  it('정수 여부·before_seconds 허용값은 서버 판정 — 모양만 맞으면 통과', () => {
    expect(() =>
      notificationOptionsInputSchema.parse([
        { type_text: 'before', before_seconds: 1234 },
        { type_text: 'before', before_seconds: 600.5 },
      ]),
    ).not.toThrow()
  })

  it.each([
    ['모르는 type_text', { type_text: 'minutes_before', minutes: 30 }],
    ['type_text 없음', { before_seconds: 600 }],
    ['before 에 before_seconds 없음', { type_text: 'before' }],
    ['allDay9AMBefore 에 before_seconds 없음', { type_text: 'allDay9AMBefore' }],
    ['before_seconds 문자열', { type_text: 'before', before_seconds: '600' }],
    ['custom 에 custom_components 없음', { type_text: 'custom' }],
    [
      'custom_components 필수 키 누락',
      { type_text: 'custom', custom_components: { year: 2026, month: 11, day: 20, hour: 9 } },
    ],
  ])('거절 — %s', (_label, option) => {
    expect(() => notificationOptionsInputSchema.parse([option])).toThrow()
  })

  it('배열이 아니면 거절', () => {
    expect(() => notificationOptionsInputSchema.parse({ type_text: 'at_time' })).toThrow()
  })
})
