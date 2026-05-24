import { describe, expect, it } from 'vitest'
import { augmentIso, parseOffsetSeconds, tsToLocalDate, tsToUtcIso } from '../../../src/tools/shared/time.js'

describe('tsToUtcIso', () => {
  it('ts(초) → UTC ISO with Z', () => {
    expect(tsToUtcIso(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })
})

describe('tsToLocalDate', () => {
  it('seconds_from_gmt 적용해 로컬 날짜(YYYY-MM-DD)', () => {
    // 1700000000 = 2023-11-14T22:13:20Z; +09:00(32400s) → 로컬 2023-11-15
    expect(tsToLocalDate(1_700_000_000, 32_400)).toBe('2023-11-15')
  })
  it('offset 0이면 UTC 날짜', () => {
    expect(tsToLocalDate(1_700_000_000, 0)).toBe('2023-11-14')
  })
})

describe('parseOffsetSeconds', () => {
  it('+09:00 → 32400', () => {
    expect(parseOffsetSeconds('2026-05-22T00:00:00+09:00')).toBe(32_400)
  })
  it('-05:30 → -19800', () => {
    expect(parseOffsetSeconds('2026-05-22T00:00:00-05:30')).toBe(-19_800)
  })
  it('Z → 0', () => {
    expect(parseOffsetSeconds('2026-05-22T00:00:00Z')).toBe(0)
  })
  it('offset 없으면 throw', () => {
    expect(() => parseOffsetSeconds('2026-05-22T00:00:00')).toThrow()
  })
  it('Z가 끝이 아닌 위치에 있으면 throw', () => {
    expect(() => parseOffsetSeconds('2026-05-22T00:00:00Zextra')).toThrow()
  })
})

describe('augmentIso — event_time', () => {
  it("at: timestamp_iso(UTC) 추가, raw 보존", () => {
    const out = augmentIso({ event_time: { time_type: 'at', timestamp: 1_700_000_000 } }) as Record<string, unknown>
    expect((out.event_time as Record<string, unknown>).timestamp).toBe(1_700_000_000)
    expect((out.event_time as Record<string, unknown>).timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
  })
  it('period: period_start_iso/period_end_iso(UTC)', () => {
    const out = augmentIso({
      event_time: { time_type: 'period', period_start: 1_700_000_000, period_end: 1_700_003_600 },
    }) as Record<string, unknown>
    expect((out.event_time as Record<string, unknown>).period_start_iso).toBe('2023-11-14T22:13:20.000Z')
    expect((out.event_time as Record<string, unknown>).period_end_iso).toBe('2023-11-14T23:13:20.000Z')
  })
  it('allday: seconds_from_gmt 적용한 로컬 날짜', () => {
    const out = augmentIso({
      event_time: {
        time_type: 'allday',
        period_start: 1_700_000_000,
        period_end: 1_700_000_000,
        seconds_from_gmt: 32_400,
      },
    }) as Record<string, unknown>
    expect((out.event_time as Record<string, unknown>).period_start_iso).toBe('2023-11-15')
    expect((out.event_time as Record<string, unknown>).period_end_iso).toBe('2023-11-15')
  })
})

describe('augmentIso — 기타 구조', () => {
  it('repeating: start_iso/end_iso', () => {
    const out = augmentIso({
      repeating: { start: 1_700_000_000, option: { optionType: 'every_day', interval: 1 }, end: 1_700_003_600 },
    }) as Record<string, unknown>
    expect((out.repeating as Record<string, unknown>).start_iso).toBe('2023-11-14T22:13:20.000Z')
    expect((out.repeating as Record<string, unknown>).end_iso).toBe('2023-11-14T23:13:20.000Z')
  })
  it('top-level create_timestamp / done_at', () => {
    const out = augmentIso({ create_timestamp: 1_700_000_000, done_at: 1_700_003_600 }) as Record<string, unknown>
    expect(out.create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
    expect(out.done_at_iso).toBe('2023-11-14T23:13:20.000Z')
  })
  it('exclude_repeatings 배열 → exclude_repeatings_iso 배열', () => {
    const out = augmentIso({ exclude_repeatings: [1_700_000_000, 1_700_003_600] }) as Record<string, unknown>
    expect(out.exclude_repeatings_iso).toEqual(['2023-11-14T22:13:20.000Z', '2023-11-14T23:13:20.000Z'])
  })
  it('배열 응답·중첩 객체 재귀 처리', () => {
    const out = augmentIso([{ create_timestamp: 1_700_000_000 }]) as Record<string, unknown>[]
    expect((out[0] as Record<string, unknown>).create_timestamp_iso).toBe('2023-11-14T22:13:20.000Z')
  })
  it('시간 필드 없으면 그대로 (notification_options 무변경)', () => {
    const input = { notification_options: [{ type_text: 'before', before_seconds: 600 }] }
    expect(augmentIso(input)).toEqual(input)
  })
  it('unknown 필드 보존 (raw passthrough)', () => {
    const out = augmentIso({ create_timestamp: 1_700_000_000, extra: 'kept' }) as Record<string, unknown>
    expect(out.extra).toBe('kept')
  })
})
