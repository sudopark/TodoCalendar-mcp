import { z } from 'zod'

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
    "Tagged union by `time_type`: 'at' (single moment), 'period' (start..end), 'allday' (date range with timezone).",
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
  .describe('Recurrence rule with start, option payload, and optional end (date or count).')

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
  .describe('A todo item. All timestamps are Unix epoch seconds (UTC).')

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
  .describe('A completed (done) todo. All timestamps are Unix epoch seconds (UTC).')

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
        `Occurrence start timestamps that are excluded from the recurrence. Each value is ${TS_SEC}`,
      ),
  })
  .describe('A schedule (calendar event). All timestamps are Unix epoch seconds (UTC).')

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
