import { describe, expect, it } from 'vitest'
import {
  eventTimeInputSchema,
  occurrenceSchema,
  repeatingInputSchema,
} from '../../../src/tools/shared/schemas.js'

describe('eventTimeInputSchema — ISO → ts transform', () => {
  it('at: ISO(offset) → timestamp(ts)', () => {
    const out = eventTimeInputSchema.parse({ time_type: 'at', timestamp: '2023-11-14T22:13:20Z' })
    expect(out).toEqual({ time_type: 'at', timestamp: 1_700_000_000 })
  })
  it('period: 두 ISO → ts 두 개', () => {
    const out = eventTimeInputSchema.parse({
      time_type: 'period',
      period_start: '2023-11-14T22:13:20Z',
      period_end: '2023-11-14T23:13:20Z',
    })
    expect(out).toEqual({ time_type: 'period', period_start: 1_700_000_000, period_end: 1_700_003_600 })
  })
  it('allday: offset에서 seconds_from_gmt 도출', () => {
    const out = eventTimeInputSchema.parse({
      time_type: 'allday',
      period_start: '2026-05-22T00:00:00+09:00',
      period_end: '2026-05-23T00:00:00+09:00',
    })
    expect(out.seconds_from_gmt).toBe(32_400)
    expect(out.period_start).toBe(Math.floor(Date.parse('2026-05-22T00:00:00+09:00') / 1000))
  })
  it('잘못된 ISO → throw (백엔드 호출 전 차단)', () => {
    expect(() => eventTimeInputSchema.parse({ time_type: 'at', timestamp: 'not-a-date' })).toThrow()
  })
  it('allday인데 offset 없음 → throw', () => {
    expect(() =>
      eventTimeInputSchema.parse({
        time_type: 'allday',
        period_start: '2026-05-22T00:00:00',
        period_end: '2026-05-23T00:00:00',
      }),
    ).toThrow()
  })
  // ISO 8601 표준상 naked datetime은 UTC가 아니라 "타임존 미지정" — JS Date.parse는 로컬 TZ로 해석해
  // 실행 머신마다 다른 ts가 나온다. at/period도 allday와 동일하게 offset 강제(Z 또는 +HH:MM).
  it('at: offset 없는 ISO → throw (UTC도 Z 명시 필수)', () => {
    expect(() =>
      eventTimeInputSchema.parse({ time_type: 'at', timestamp: '2023-11-14T22:13:20' }),
    ).toThrow()
  })
  it('period: offset 없는 ISO → throw', () => {
    expect(() =>
      eventTimeInputSchema.parse({
        time_type: 'period',
        period_start: '2023-11-14T22:13:20',
        period_end: '2023-11-14T23:13:20',
      }),
    ).toThrow()
  })
})

describe('repeatingInputSchema — ISO → ts transform', () => {
  it('start ISO → ts, option passthrough, end optional', () => {
    const out = repeatingInputSchema.parse({
      start: '2023-11-14T22:13:20Z',
      option: { optionType: 'every_day', interval: 1 },
      end: '2023-11-14T23:13:20Z',
    })
    expect(out.start).toBe(1_700_000_000)
    expect(out.end).toBe(1_700_003_600)
    expect(out.option).toEqual({ optionType: 'every_day', interval: 1 })
  })
})

describe('occurrenceSchema', () => {
  it('origin_event_id + turn + event_time(at) 통과', () => {
    const parsed = occurrenceSchema.parse({
      origin_event_id: 'todo-abc',
      turn: 3,
      event_time: { time_type: 'at', timestamp: 1_690_000_000 },
    })
    expect(parsed.turn).toBe(3)
    expect(parsed.origin_event_id).toBe('todo-abc')
  })

  it('turn 누락 — throw', () => {
    expect(() =>
      occurrenceSchema.parse({
        origin_event_id: 'x',
        event_time: { time_type: 'at', timestamp: 1 },
      }),
    ).toThrow()
  })
})
