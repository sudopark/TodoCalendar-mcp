import { describe, expect, it } from 'vitest'
import { parseOffsetSeconds, tsToLocalDate, tsToUtcIso } from '../../../src/tools/shared/time.js'

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
