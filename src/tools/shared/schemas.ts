import { z } from 'zod'
import { parseOffsetSeconds } from './time.js'

const TS_SEC =
  'Unix epoch seconds (UTC). Convert with `new Date(value * 1000)` if a wall-clock representation is needed.'

const eventTimeAt = z.object({
  time_type: z.literal('at'),
  timestamp: z.number().describe(TS_SEC),
})

const eventTimePeriod = z.object({
  time_type: z.literal('period'),
  period_start: z.number().describe(TS_SEC),
  period_end: z.number().describe(TS_SEC),
})

const eventTimeAllDay = z.object({
  time_type: z.literal('allday'),
  period_start: z.number().describe(TS_SEC),
  period_end: z.number().describe(TS_SEC),
  seconds_from_gmt: z.number().describe('Timezone offset in seconds east of UTC.'),
})

export const eventTimeSchema = z
  .discriminatedUnion('time_type', [eventTimeAt, eventTimePeriod, eventTimeAllDay])
  .describe(
    "Tagged union by `time_type`: 'at' (single moment), 'period' (start..end), 'allday' (date range with timezone). Responses include the following `*_iso` siblings: 'at' → timestamp_iso (UTC ISO); 'period' → period_start_iso + period_end_iso (UTC ISO); 'allday' → period_start_iso + period_end_iso (YYYY-MM-DD local date computed from `seconds_from_gmt`). Raw Unix-second fields are preserved alongside.",
  )

const ISO_DESC =
  "ISO 8601 datetime with timezone offset (e.g. \"2026-05-22T10:00:00+09:00\" or \"...Z\"). Server converts to Unix epoch seconds. Use the end user's timezone offset."

// 공통 ISO 8601 → Unix epoch seconds 변환. transform context에 issue를 추가하고 실패 시 z.NEVER.
// offset 필수: naked datetime은 ISO 8601 상 "타임존 미지정"이고 Date.parse가 로컬 TZ로 해석해
// 실행 머신(Cloud Run vs dev)마다 다른 ts가 나옴. UTC도 'Z' 명시 필요.
const isoStringToTs = (s: string, ctx: z.RefinementCtx): number => {
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid ISO 8601 datetime: ${s}` })
    return z.NEVER
  }
  try {
    parseOffsetSeconds(s)
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message })
    return z.NEVER
  }
  return Math.floor(ms / 1000)
}

// ISO 8601 문자열을 받아 Unix epoch seconds로 변환하는 입력 전용 스키마.
// 잘못된 ISO는 zod 검증 에러 → tool이 throw(백엔드 호출 X).
const isoToTs = z.string().transform((s, ctx) => isoStringToTs(s, ctx))

export const isoToTsField = isoToTs.describe(ISO_DESC)

const eventTimeAtIso = z.object({ time_type: z.literal('at'), timestamp: z.string() })
const eventTimePeriodIso = z.object({
  time_type: z.literal('period'),
  period_start: z.string(),
  period_end: z.string(),
})
const eventTimeAllDayIso = z.object({
  time_type: z.literal('allday'),
  period_start: z.string(),
  period_end: z.string(),
})

// 입력 event_time: ISO 문자열을 받아 openAPI body 모양(ts + allday의 seconds_from_gmt)으로 transform.
export const eventTimeInputSchema = z
  .discriminatedUnion('time_type', [eventTimeAtIso, eventTimePeriodIso, eventTimeAllDayIso])
  .transform((v, ctx) => {
    switch (v.time_type) {
      case 'at':
        return { time_type: 'at' as const, timestamp: isoStringToTs(v.timestamp, ctx) }
      case 'period':
        return {
          time_type: 'period' as const,
          period_start: isoStringToTs(v.period_start, ctx),
          period_end: isoStringToTs(v.period_end, ctx),
        }
      case 'allday': {
        let secondsFromGmt = 0
        try {
          secondsFromGmt = parseOffsetSeconds(v.period_start)
        } catch (e) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message })
        }
        return {
          time_type: 'allday' as const,
          period_start: isoStringToTs(v.period_start, ctx),
          period_end: isoStringToTs(v.period_end, ctx),
          seconds_from_gmt: secondsFromGmt,
        }
      }
    }
  })
  .describe(
    "Input event_time. Tagged union by `time_type` ('at' | 'period' | 'allday'). All time fields are ISO 8601 strings WITH timezone offset; the server converts to Unix epoch seconds. For 'allday', seconds_from_gmt is derived from the offset (do not pass it).",
  )

// 입력 repeating: start/end를 ISO로 받아 ts로 transform. option은 opaque passthrough.
export const repeatingInputSchema = z
  .object({
    start: z.string(),
    option: z.unknown(),
    end: z.string().nullish(),
    end_count: z.number().nullish(),
  })
  .transform((v, ctx) => ({
    start: isoStringToTs(v.start, ctx),
    option: v.option,
    ...(v.end !== undefined && v.end !== null ? { end: isoStringToTs(v.end, ctx) } : {}),
    ...(v.end_count !== undefined && v.end_count !== null ? { end_count: v.end_count } : {}),
  }))
  .describe(
    'Input recurrence rule. `start`/`end` are ISO 8601 strings (server → Unix seconds). `option` is the discriminated recurrence object (see repeatingSchema description).',
  )

// option은 string처럼 보이지만 실제로는 optionType 디스크리미네이터 object.
// Source of truth: TodoCalendar/Repository/.../EventRepeatingOption+CodableMapper.swift (snapshot 2026-05-10).
const repeatingOptionDescribe = `\
Recurrence rule object discriminated by 'optionType'. Variants:
  - { optionType: 'every_day', interval: int(1..999) }
  - { optionType: 'every_week', interval: int(1..5), dayOfWeek: int[] (1=Sun..7=Sat), timeZone: IANA id }
  - { optionType: 'every_month', interval: int(1..11), monthDaySelection: { days: int[] (1..31) } | { weekOrdinals: ({ isLast: true } | { isLast: false, seq: int })[], weekDays: int[] (1=Sun..7=Sat) }, timeZone: IANA id }
  - { optionType: 'every_year', interval: int(1..99), months: int[] (1..12), weekOrdinals: ({ isLast: true } | { isLast: false, seq: int })[], dayOfWeek: int[] (1=Sun..7=Sat), timeZone: IANA id }
  - { optionType: 'every_year_some_day', interval: int(>=1), month: int(1..12), day: int(1..31), timeZone: IANA id }
  - { optionType: 'lunar_calendar_every_year', month: int(1..12), day: int(1..30), timeZone: IANA id }
NOTE on key naming asymmetry across variants: 'every_month.monthDaySelection' uses 'weekDays' (plural form via 'monthDaySelection.weekDays') while 'every_year' uses 'dayOfWeek' (singular field name, holds an array). Don't confuse the two when round-tripping. Snapshot of TodoCalendar iOS EventRepeatingOption+CodableMapper.swift as of 2026-05-10.`

export const repeatingSchema = z
  .object({
    start: z.number().describe(TS_SEC),
    option: z.unknown().describe(repeatingOptionDescribe),
    end: z.number().nullish().describe(`${TS_SEC} Null if no end date.`),
    end_count: z.number().nullish().describe('Number of occurrences. Null if not capped by count.'),
  })
  .describe('Recurrence rule with start, option payload, and optional end (date or count). Responses also include `start_iso` / `end_iso` (UTC ISO).')

export const todoSchema = z
  .object({
    uuid: z.string().describe('Stable id used to reference this todo in subsequent calls.'),
    userId: z
      .string()
      .describe(
        'Owner user id as recorded by the openAPI. Typically the authenticated caller; preserved verbatim so consumers can audit/cache the raw payload.',
      ),
    name: z.string(),
    is_current: z
      .boolean()
      .describe(
        'True if this is a "current" (non-time-bound) todo that should always be visible until completed. Typically equivalent to `event_time` being absent, but treat this field as the source of truth — the equivalence is not guaranteed in all cases by the openAPI contract.',
      ),
    create_timestamp: z.number().describe(TS_SEC),
    event_tag_id: z.string().nullish(),
    event_time: eventTimeSchema.optional(),
    repeating: repeatingSchema.optional(),
    notification_options: z
      .array(z.unknown())
      .nullish()
      .describe('Opaque notification config objects (see TodoCalendar app docs for shape).'),
    repeating_turn: z
      .string()
      .nullish()
      .describe('For repeating todos: identifier of the specific occurrence (turn).'),
  })
  .describe('A todo item. Raw Unix-second timestamps are preserved; responses also include `create_timestamp_iso` and `event_time` / `repeating` `*_iso` siblings (see those schemas).')

export const doneTodoSchema = z
  .object({
    uuid: z.string().describe('Done-todo id (distinct from the original todo uuid).'),
    userId: z.string(),
    name: z.string(),
    origin_event_id: z
      .string()
      .nullish()
      .describe('UUID of the originating todo, if this was completed from one.'),
    done_at: z.number().nullish().describe(`${TS_SEC} Null if completion time is unknown.`),
    event_time: eventTimeSchema.optional(),
    event_tag_id: z.string().nullish(),
    notification_options: z.array(z.unknown()).nullish(),
  })
  .describe('A completed (done) todo. Raw Unix-second timestamps are preserved; responses also include `done_at_iso` and `event_time` `*_iso` siblings.')

export const scheduleSchema = z
  .object({
    uuid: z.string(),
    userId: z.string(),
    name: z.string(),
    event_tag_id: z.string().nullish(),
    event_time: eventTimeSchema.optional(),
    repeating: repeatingSchema.optional(),
    notification_options: z.array(z.unknown()).nullish(),
    show_turns: z
      .record(z.string(), z.unknown())
      .nullish()
      .describe(
        'Per-occurrence visibility map for repeating schedules (opaque key→value object).',
      ),
    exclude_repeatings: z
      .array(z.number())
      .nullish()
      .describe(
        `Occurrence start timestamps that are excluded from the recurrence. Each value is a Unix epoch second. A sibling \`exclude_repeatings_iso: string[]\` (UTC ISO) is included in the response.`,
      ),
  })
  .describe('A schedule (calendar event). Raw Unix-second timestamps are preserved; responses also include `event_time` / `repeating` `*_iso` siblings and `exclude_repeatings_iso` (UTC ISO array).')

export const eventTagSchema = z
  .object({
    uuid: z.string(),
    userId: z.string(),
    name: z.string(),
    color_hex: z
      .string()
      .nullish()
      .describe('Hex color code (e.g. "#ff8800"). Null if using the default color.'),
  })
  .describe('Event tag/category for grouping todos and schedules.')

export const eventDetailSchema = z
  .object({
    place: z.string().nullish(),
    url: z.string().nullish(),
    memo: z.string().nullish(),
  })
  .describe('Optional metadata attached to a todo or schedule.')

// §6 raw passthrough — outputSchema는 LLM에 노출되는 description 채널일 뿐, runtime parse하지 않는다.
// openAPI가 추가 필드를 돌려주더라도 그대로 흘러가야 round-trip·감사로그 무손실 약속이 유지됨.
export const statusOkSchema = z
  .object({
    status: z.string().describe('Operation status string, typically "ok".'),
  })
  .describe(
    'Generic success envelope returned by mutation endpoints that do not echo the entity. Any additional fields the openAPI returns are preserved verbatim (raw passthrough).',
  )

// CONFIRM 게이트 tool의 outputSchema. 두 분기(first call의 confirm_required envelope /
// second call의 status:"ok")를 단일 object로 평탄화. root anyOf을 만들면 Anthropic API
// (input_schema) 거부 + MCP outputSchema silent drop 양쪽 깨짐(#41). runtime parse 안 함(§6)
// 이라 모양은 LLM hint 전용 — status가 discriminator, 분기별 필드는 모두 optional.
export const confirmableStatusSchema = z
  .object({
    status: z
      .enum(['confirm_required', 'ok'])
      .describe(
        'Discriminator. "confirm_required" = first call (no destructive effect — message/confirmToken/action/target are populated). "ok" = second call after actual execution.',
      ),
    message: z
      .string()
      .optional()
      .describe(
        'Populated when status="confirm_required". Human-readable confirmation prompt to surface to the end user before re-calling.',
      ),
    confirmToken: z
      .string()
      .optional()
      .describe(
        'Populated when status="confirm_required". Opaque token to echo back on the next call to actually execute. Expires in 5 minutes. Verification is stateless — re-usable until expiry against the SAME args under the SAME user; re-issue a fresh token if intent changes.',
      ),
    action: z
      .string()
      .optional()
      .describe(
        'Populated when status="confirm_required". The tool name this token is scoped to.',
      ),
    target: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Populated when status="confirm_required". The arguments this token is bound to. On re-call, pass the SAME arguments that appear under `target` (alongside `confirmToken`) — do NOT mutate `target` itself.',
      ),
  })
  .describe(
    'CONFIRM-gated tool result. First call: { status:"confirm_required", message, confirmToken, action, target } — no backend mutation. Second call (with confirmToken): { status:"ok" } after actual execution. Any additional fields the openAPI returns on the second call are preserved verbatim (raw passthrough).',
  )
