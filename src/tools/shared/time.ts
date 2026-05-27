// ISO 8601 ↔ Unix epoch seconds 변환 + 출력 augment. 비즈니스 로직 없음 — 단순 표현 변환.

export const tsToUtcIso = (ts: number): string => new Date(ts * 1000).toISOString()

// allday 등 tz가 알려진 ts를 로컬 날짜(YYYY-MM-DD)로. seconds_from_gmt는 UTC 동쪽이 양수.
export const tsToLocalDate = (ts: number, secondsFromGmt: number): string =>
  new Date((ts + secondsFromGmt) * 1000).toISOString().slice(0, 10)

const OFFSET_RE = /(?:(Z)|([+-])(\d{2}):(\d{2}))$/

// ISO 문자열 끝의 offset을 초로. Z=0, +09:00=32400. offset 없으면 throw (allday는 offset 필수).
export const parseOffsetSeconds = (iso: string): number => {
  const m = OFFSET_RE.exec(iso)
  if (m === null) throw new Error(`ISO datetime missing timezone offset: ${iso}`)
  if (m[1] === 'Z') return 0
  const sign = m[2] === '-' ? -1 : 1
  const hours = Number(m[3])
  const minutes = Number(m[4])
  return sign * (hours * 3600 + minutes * 60)
}

const isNum = (v: unknown): v is number => typeof v === 'number'

// 응답을 재귀 walk하며 알려진 시간 구조에만 *_iso 형제 필드를 additive로 추가.
// raw ts는 그대로 보존. zod 안 씀(§6: outputSchema.parse 금지).
export const augmentIso = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(augmentIso)
  if (value === null || typeof value !== 'object') return value

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = augmentIso(v)

  // event_time (time_type 디스크리미네이터)
  if (obj.time_type === 'at' && isNum(obj.timestamp)) {
    out.timestamp_iso = tsToUtcIso(obj.timestamp)
  } else if (obj.time_type === 'period' && isNum(obj.period_start) && isNum(obj.period_end)) {
    out.period_start_iso = tsToUtcIso(obj.period_start)
    out.period_end_iso = tsToUtcIso(obj.period_end)
  } else if (
    obj.time_type === 'allday' &&
    isNum(obj.period_start) &&
    isNum(obj.period_end) &&
    isNum(obj.seconds_from_gmt)
  ) {
    out.period_start_iso = tsToLocalDate(obj.period_start, obj.seconds_from_gmt)
    out.period_end_iso = tsToLocalDate(obj.period_end, obj.seconds_from_gmt)
  }

  // repeating (start + option 동시 존재로 식별)
  if (isNum(obj.start) && 'option' in obj) {
    out.start_iso = tsToUtcIso(obj.start)
    if (isNum(obj.end)) out.end_iso = tsToUtcIso(obj.end)
  }

  // top-level scalar ts
  if (isNum(obj.create_timestamp)) out.create_timestamp_iso = tsToUtcIso(obj.create_timestamp)
  if (isNum(obj.done_at)) out.done_at_iso = tsToUtcIso(obj.done_at)

  // exclude_repeatings: number[]
  if (Array.isArray(obj.exclude_repeatings)) {
    out.exclude_repeatings_iso = obj.exclude_repeatings
      .filter(isNum)
      .map((n) => tsToUtcIso(n))
  }

  return out
}
