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
