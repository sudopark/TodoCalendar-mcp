# Expanded Occurrence 조회 tool 2종 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** openAPI `/v2/open/{todos,schedules}/expanded` (반복 이벤트 서버 전개, TodoCalendar-Functions#244)를 호출하는 MCP tool 2종(`get_expanded_todos` / `get_expanded_schedules`)을 추가하고, 기존 조회 tool description을 디마케팅해 반복 전개가 필요한 질의를 expanded로 유도한다.

**Architecture:** 기존 tool 패턴(`ToolDefinition` + `callOpenApi` + `wrapOpenApiError` + `augmentIso`) 그대로. 신규 shared infra 불필요 — occurrence 정규화 응답(`{events, occurrences, next_cursor}`)을 위한 zod 스키마만 `shared/schemas.ts`에 추가. tool 본체는 각 도메인 파일(`todoTools.ts` / `scheduleTools.ts`)의 기존 조회 tool 옆에 둔다. `augmentIso`는 재귀 walker라 중첩 occurrence·events의 `*_iso` 파생 필드를 자동 생성 — 손대지 않는다.

**Tech Stack:** Node.js 24 / TypeScript, zod, vitest. openAPI 인증은 `callOpenApi`(PAT + 자체 서명 HS256 JWT)가 흡수.

**참조:** 이슈 #69, Functions PR #244, `docs/spec/openapi.md`(Functions 레포)의 "Occurrence 전개 조회" 섹션.

---

## File Structure

- `src/tools/shared/schemas.ts` (수정) — `occurrenceSchema` 신규 export. `eventTimeSchema` 재사용.
- `src/tools/scheduleTools.ts` (수정) — `getExpandedSchedules` 신규 tool. 기존 `getSchedules` description 디마케팅.
- `src/tools/todoTools.ts` (수정) — `getExpandedTodos` 신규 tool. 기존 `getTodos` range mode description 디마케팅.
- `src/tools/index.ts` (수정) — registry 배열 + import + export 블록에 2종 추가.
- `test/tools/getExpandedSchedules.test.ts` (신규) — 단위.
- `test/tools/getExpandedTodos.test.ts` (신규) — 단위.
- `test/tools/index.test.ts` (수정) — registry 키 목록 2개 추가.
- `test/integration/expanded.test.ts` (신규) — emulator E2E.
- `README.md` / `CLAUDE.md` (수정) — tool 수 27 → 29.

**occurrence 응답 형태 (Functions #244 — 두 tool 공통):**

```jsonc
{
  "events": { "<origin_id>": { /* todoSchema 또는 scheduleSchema 원본 + repeating */ } },
  "occurrences": [
    { "origin_event_id": "<origin_id>", "turn": 3, "event_time": { "time_type": "at", "timestamp": 1690000000 } }
  ],
  "next_cursor": "eyJ0Ijo..."   // null이면 마지막 페이지
}
```

---

## Task 1: `occurrenceSchema` 추가 (shared/schemas.ts)

**Files:**
- Modify: `src/tools/shared/schemas.ts` (현재 `eventTimeSchema` 정의는 25-29행 부근)
- Test: `test/tools/shared/schemas.test.ts`

occurrence 항목은 todos/schedules 공통 모양이라 shared로 둔다. expanded output 객체(`{events, occurrences, next_cursor}`)는 events 값 타입이 도메인마다 달라(`todoSchema` vs `scheduleSchema`) 각 tool 파일에서 조립한다.

- [ ] **Step 1: occurrenceSchema 테스트 추가**

`test/tools/shared/schemas.test.ts` 끝에 추가 (기존 import에 `occurrenceSchema` 추가):

```typescript
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tools/shared/schemas.test.ts -t occurrenceSchema`
Expected: FAIL — `occurrenceSchema` is not exported / undefined.

- [ ] **Step 3: occurrenceSchema 구현**

`src/tools/shared/schemas.ts`에서 `eventTimeSchema` export 정의 **바로 아래**에 추가:

```typescript
export const occurrenceSchema = z
  .object({
    origin_event_id: z
      .string()
      .describe('UUID of the origin event. Look up its full metadata in the response `events` map.'),
    turn: z
      .number()
      .int()
      .describe(
        '1-based occurrence number counted from `repeating.start` (non-repeating events are always 1). Excluded occurrences do NOT consume a turn (subsequent numbers are not shifted). Synthesize a stable occurrence id as `"{origin_event_id}:{turn}"` if needed.',
      ),
    event_time: eventTimeSchema.describe('Computed event_time for THIS occurrence (Unix seconds; `*_iso` siblings added in the response).'),
  })
  .describe(
    'A single expanded occurrence of an event. Lightweight — origin metadata (name, tags, repeating rule) lives once in the response `events` map, keyed by `origin_event_id`.',
  )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/tools/shared/schemas.test.ts -t occurrenceSchema`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared/schemas.ts test/tools/shared/schemas.test.ts
git commit -m "[#69] occurrenceSchema 추가 — expanded 응답의 회차 항목 모양"
```

---

## Task 2: `get_expanded_schedules` tool (scheduleTools.ts)

**Files:**
- Modify: `src/tools/scheduleTools.ts` (기존 `getSchedules`는 16-51행. import 블록 6-14행)
- Test: `test/tools/getExpandedSchedules.test.ts`

**참조 패턴:** `test/tools/getSchedules.test.ts` (openApiSpy 모킹 구조를 그대로 복제).

- [ ] **Step 1: 단위 테스트 작성**

`test/tools/getExpandedSchedules.test.ts` 신규:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auth } from '../../src/auth/types.js'
import { InvalidParameterError } from '../../src/openapi/errors.js'

interface OpenApiSpy {
  lastMethod: string | null
  lastPath: string | null
  callCount: number
  responsePayload: unknown
  responseError: Error | null
}

const openApiSpy: OpenApiSpy = {
  lastMethod: null,
  lastPath: null,
  callCount: 0,
  responsePayload: null,
  responseError: null,
}

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: async (_auth: Auth, method: string, path: string) => {
    openApiSpy.lastMethod = method
    openApiSpy.lastPath = path
    openApiSpy.callCount++
    if (openApiSpy.responseError) throw openApiSpy.responseError
    return openApiSpy.responsePayload
  },
}))

const { getExpandedSchedules } = await import('../../src/tools/scheduleTools.js')

const auth: Auth = { userId: 'u-1', scopes: ['read:calendar'] }

beforeEach(() => {
  openApiSpy.lastMethod = null
  openApiSpy.lastPath = null
  openApiSpy.callCount = 0
  openApiSpy.responseError = null
  openApiSpy.responsePayload = { events: {}, occurrences: [], next_cursor: null }
})

describe('get_expanded_schedules', () => {
  it('lower/upper ISO → expanded 경로 + ts 쿼리', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastMethod).toBe('GET')
    expect(openApiSpy.lastPath).toBe(
      '/v2/open/schedules/expanded?lower=1700000000&upper=1700086400',
    )
  })

  it('limit·cursor 있으면 쿼리에 포함', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
      limit: 50,
      cursor: 'abc',
    })
    expect(openApiSpy.lastPath).toBe(
      '/v2/open/schedules/expanded?lower=1700000000&upper=1700086400&limit=50&cursor=abc',
    )
  })

  it('limit·cursor 없으면 쿼리에서 생략', async () => {
    await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T22:13:20Z',
      upper: '2023-11-15T22:13:20Z',
    })
    expect(openApiSpy.lastPath).not.toContain('limit')
    expect(openApiSpy.lastPath).not.toContain('cursor')
  })

  it('lower 누락 — zod throw, 백엔드 호출 안 함', async () => {
    await expect(
      getExpandedSchedules.execute(auth, { upper: '2023-11-14T22:13:20Z' }),
    ).rejects.toThrow()
    expect(openApiSpy.callCount).toBe(0)
  })

  it('raw 보존 + occurrences/events에 *_iso 형제 필드 추가', async () => {
    openApiSpy.responsePayload = {
      events: {
        's-1': {
          uuid: 's-1',
          userId: 'u-1',
          name: 'meeting',
          event_time: { time_type: 'at', timestamp: 1_700_000_000 },
          repeating: { start: 1_690_000_000, option: { optionType: 'every_day', interval: 1 } },
        },
      },
      occurrences: [
        {
          origin_event_id: 's-1',
          turn: 2,
          event_time: { time_type: 'at', timestamp: 1_700_086_400 },
        },
      ],
      next_cursor: 'eyJ0Ijo',
    }

    const result = (await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-15T00:00:00Z',
    })) as Record<string, any>

    // occurrence event_time *_iso
    expect(result.occurrences[0].event_time.timestamp_iso).toBe('2023-11-15T22:13:20.000Z')
    // event_time raw 보존
    expect(result.occurrences[0].event_time.timestamp).toBe(1_700_086_400)
    // events 안 origin의 repeating *_iso
    expect(result.events['s-1'].repeating.start_iso).toBe('2023-07-22T07:06:40.000Z')
    // next_cursor passthrough
    expect(result.next_cursor).toBe('eyJ0Ijo')
  })

  it('OpenApiError → ToolError', async () => {
    openApiSpy.responseError = new InvalidParameterError('window too large')
    await expect(
      getExpandedSchedules.execute(auth, {
        lower: '2023-11-14T00:00:00Z',
        upper: '2025-11-14T00:00:00Z',
      }),
    ).rejects.toThrow(/window too large/)
  })

  it('metadata — name·scope', () => {
    expect(getExpandedSchedules.name).toBe('get_expanded_schedules')
    expect(getExpandedSchedules.scopes).toEqual(['read:calendar'])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tools/getExpandedSchedules.test.ts`
Expected: FAIL — `getExpandedSchedules` is not exported from scheduleTools.

- [ ] **Step 3: tool 구현**

`src/tools/scheduleTools.ts` import에서 `occurrenceSchema`, `scheduleSchema`를 가져온다 (기존 `scheduleSchema`는 이미 import 중 — `occurrenceSchema` 추가):

```typescript
import {
  confirmableStatusSchema,
  eventTimeInputSchema,
  isoToTsField,
  occurrenceSchema,
  repeatingInputSchema,
  scheduleSchema,
} from './shared/schemas.js'
```

기존 `getSchedules` 정의(51행) **바로 아래**에 추가:

```typescript
const getExpandedSchedulesInput = z
  .object({
    lower: isoToTsField.describe('Range start (inclusive). ISO 8601 datetime with offset.'),
    upper: isoToTsField.describe('Range end (inclusive). ISO 8601 datetime with offset.'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Max occurrences per page (default 100, max 500 — values above 500 are clamped server-side).'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque pagination cursor. Pass the previous response `next_cursor` verbatim to get the next page; omit for the first page.'),
  })
  .describe(
    'Both lower and upper are required. The window `upper - lower` must be <= 1 year (server returns 400 otherwise) — split longer spans into per-year calls.',
  )

type GetExpandedSchedulesInput = z.infer<typeof getExpandedSchedulesInput>

const getExpandedSchedulesOutput = z
  .object({
    events: z
      .record(z.string(), scheduleSchema)
      .describe('Origin schedule metadata, keyed by origin_event_id, one entry per origin appearing on this page (includes the repeating rule).'),
    occurrences: z
      .array(occurrenceSchema)
      .describe('Time-ordered flat list of expanded occurrences for this page.'),
    next_cursor: z
      .string()
      .nullable()
      .describe('Opaque cursor for the next page; null on the last page.'),
  })
  .describe(
    'Normalized expansion response: origin metadata (`events`) separated from per-occurrence rows (`occurrences`). Every absolute-time field carries a sibling `*_iso` (UTC ISO; allday → YYYY-MM-DD local date). Raw Unix-second fields are preserved alongside.',
  )

type GetExpandedSchedulesOutput = z.infer<typeof getExpandedSchedulesOutput>

export const getExpandedSchedules: ToolDefinition<
  GetExpandedSchedulesInput,
  GetExpandedSchedulesOutput
> = {
  name: 'get_expanded_schedules',
  scopes: ['read:calendar'],
  description: `\
List schedules over a time range [lower, upper] with REPEATING EVENTS EXPANDED to their actual occurrence dates — the server computes each recurrence turn (weekday accrual, month-end skip, leap year, lunar) so you never calculate dates yourself.

USE THIS (not get_schedules) whenever you need the real dates a recurring schedule falls on — e.g. "what's on my calendar today / this week / next month", "when does my weekly meeting actually happen". get_schedules returns ONLY raw origin rules and does NOT expand recurrences.

Response is normalized: 'events' maps origin_event_id → the origin schedule (metadata + repeating rule, one entry per origin); 'occurrences' is a time-ordered flat list of { origin_event_id, turn, event_time } — look up names/tags in 'events'. Paginated: pass the previous 'next_cursor' back via 'cursor' until it is null. Window must be <= 1 year. To advance an occurrence via replace_schedule_occurrence / exclude_schedule_occurrence, take the origin from 'events' and the occurrence's event_time.

All input time fields are ISO 8601 strings WITH timezone offset (e.g. "2026-05-22T10:00:00+09:00") — the server converts to Unix seconds. In responses, every absolute-time field has a sibling \`*_iso\` field (UTC ISO; for \`allday\`, a YYYY-MM-DD local date). Raw Unix-second fields are preserved alongside.`,
  inputSchema: getExpandedSchedulesInput,
  outputSchema: getExpandedSchedulesOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetExpandedSchedulesOutput> => {
    const { lower, upper, limit, cursor } = getExpandedSchedulesInput.parse(args)
    const qs = new URLSearchParams({ lower: String(lower), upper: String(upper) })
    if (limit !== undefined) qs.set('limit', String(limit))
    if (cursor !== undefined) qs.set('cursor', cursor)
    try {
      return augmentIso(
        await callOpenApi<GetExpandedSchedulesOutput>(
          auth,
          'GET',
          `/v2/open/schedules/expanded?${qs.toString()}`,
        ),
      ) as GetExpandedSchedulesOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/tools/getExpandedSchedules.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/scheduleTools.ts test/tools/getExpandedSchedules.test.ts
git commit -m "[#69] get_expanded_schedules tool 추가 — occurrence 전개 조회"
```

---

## Task 3: `get_expanded_todos` tool (todoTools.ts)

**Files:**
- Modify: `src/tools/todoTools.ts` (기존 `getTodos`는 80-104행, import 6-14행)
- Test: `test/tools/getExpandedTodos.test.ts`

todos에는 mode가 없다 — expanded는 항상 range+페이징 단일 모양. (current/uncompleted는 expanded 무관이라 기존 `get_todos`에 그대로 남는다.)

- [ ] **Step 1: 단위 테스트 작성**

`test/tools/getExpandedTodos.test.ts` 신규 — Task 2의 테스트 파일을 복제하되 다음만 변경:
- `getExpandedSchedules` → `getExpandedTodos`, import는 `../../src/tools/todoTools.js`
- 경로 기대값 `/v2/open/schedules/expanded` → `/v2/open/todos/expanded`
- raw 보존 테스트의 events 항목을 todo 모양으로:

```typescript
  it('raw 보존 + occurrences/events에 *_iso 형제 필드 추가', async () => {
    openApiSpy.responsePayload = {
      events: {
        'todo-1': {
          uuid: 'todo-1',
          userId: 'u-1',
          name: 'standup',
          is_current: false,
          create_timestamp: 1_690_000_000,
          event_time: { time_type: 'at', timestamp: 1_700_000_000 },
          repeating: { start: 1_690_000_000, option: { optionType: 'every_day', interval: 1 } },
        },
      },
      occurrences: [
        {
          origin_event_id: 'todo-1',
          turn: 2,
          event_time: { time_type: 'at', timestamp: 1_700_086_400 },
        },
      ],
      next_cursor: null,
    }

    const result = (await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-15T00:00:00Z',
    })) as Record<string, any>

    expect(result.occurrences[0].event_time.timestamp_iso).toBe('2023-11-15T22:13:20.000Z')
    expect(result.occurrences[0].event_time.timestamp).toBe(1_700_086_400)
    expect(result.events['todo-1'].repeating.start_iso).toBe('2023-07-22T07:06:40.000Z')
    expect(result.events['todo-1'].create_timestamp_iso).toBe('2023-07-22T07:06:40.000Z')
    expect(result.next_cursor).toBeNull()
  })
```
- metadata 테스트: `expect(getExpandedTodos.name).toBe('get_expanded_todos')`

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tools/getExpandedTodos.test.ts`
Expected: FAIL — `getExpandedTodos` is not exported from todoTools.

- [ ] **Step 3: tool 구현**

`src/tools/todoTools.ts` import에 `occurrenceSchema` 추가 (기존 schemas import 블록):

```typescript
import {
  confirmableStatusSchema,
  doneTodoSchema,
  eventDetailSchema,
  eventTimeInputSchema,
  isoToTsField,
  occurrenceSchema,
  repeatingInputSchema,
  todoSchema,
} from './shared/schemas.js'
```

기존 `getTodos` 정의(104행) **바로 아래**에 추가:

```typescript
const getExpandedTodosInput = z
  .object({
    lower: isoToTsField.describe('Range start (inclusive). ISO 8601 datetime with offset.'),
    upper: isoToTsField.describe('Range end (inclusive). ISO 8601 datetime with offset.'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Max occurrences per page (default 100, max 500 — values above 500 are clamped server-side).'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque pagination cursor. Pass the previous response `next_cursor` verbatim to get the next page; omit for the first page.'),
  })
  .describe(
    'Both lower and upper are required. The window `upper - lower` must be <= 1 year (server returns 400 otherwise) — split longer spans into per-year calls.',
  )

type GetExpandedTodosInput = z.infer<typeof getExpandedTodosInput>

const getExpandedTodosOutput = z
  .object({
    events: z
      .record(z.string(), todoSchema)
      .describe('Origin todo metadata, keyed by origin_event_id, one entry per origin appearing on this page (includes the repeating rule).'),
    occurrences: z
      .array(occurrenceSchema)
      .describe('Time-ordered flat list of expanded occurrences for this page.'),
    next_cursor: z
      .string()
      .nullable()
      .describe('Opaque cursor for the next page; null on the last page.'),
  })
  .describe(
    'Normalized expansion response: origin metadata (`events`) separated from per-occurrence rows (`occurrences`). Every absolute-time field carries a sibling `*_iso` (UTC ISO; allday → YYYY-MM-DD local date). Raw Unix-second fields are preserved alongside.',
  )

type GetExpandedTodosOutput = z.infer<typeof getExpandedTodosOutput>

export const getExpandedTodos: ToolDefinition<GetExpandedTodosInput, GetExpandedTodosOutput> = {
  name: 'get_expanded_todos',
  scopes: ['read:calendar'],
  description: `\
List time-bound todos over a range [lower, upper] with REPEATING TODOS EXPANDED to their actual occurrence dates — the server computes each recurrence turn (weekday accrual, month-end skip, leap year, lunar) so you never calculate dates yourself.

USE THIS (not get_todos mode="range") whenever you need the real dates a recurring todo falls on — e.g. "what repeating todos land this week", "when is this daily task next due". get_todos returns ONLY raw origin rules and does NOT expand recurrences. (Non-time-bound "current" todos and overdue lookups still use get_todos with mode="current" / "uncompleted" — expansion does not apply to those.)

Response is normalized: 'events' maps origin_event_id → the origin todo (metadata + repeating rule, one entry per origin); 'occurrences' is a time-ordered flat list of { origin_event_id, turn, event_time } — look up names/tags in 'events'. Paginated: pass the previous 'next_cursor' back via 'cursor' until it is null. Window must be <= 1 year. NOTE: an occurrence's 'turn' is a number, whereas complete_todo / replace_todo expect 'next_repeating_turn' as a string — stringify the turn and take the origin object from 'events' when advancing an occurrence.

All input time fields are ISO 8601 strings WITH timezone offset (e.g. "2026-05-22T10:00:00+09:00") — the server converts to Unix seconds. In responses, every absolute-time field has a sibling \`*_iso\` field (UTC ISO; for \`allday\`, a YYYY-MM-DD local date). Raw Unix-second fields are preserved alongside.`,
  inputSchema: getExpandedTodosInput,
  outputSchema: getExpandedTodosOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetExpandedTodosOutput> => {
    const { lower, upper, limit, cursor } = getExpandedTodosInput.parse(args)
    const qs = new URLSearchParams({ lower: String(lower), upper: String(upper) })
    if (limit !== undefined) qs.set('limit', String(limit))
    if (cursor !== undefined) qs.set('cursor', cursor)
    try {
      return augmentIso(
        await callOpenApi<GetExpandedTodosOutput>(
          auth,
          'GET',
          `/v2/open/todos/expanded?${qs.toString()}`,
        ),
      ) as GetExpandedTodosOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/tools/getExpandedTodos.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/todoTools.ts test/tools/getExpandedTodos.test.ts
git commit -m "[#69] get_expanded_todos tool 추가 — occurrence 전개 조회"
```

---

## Task 4: registry 등록 (index.ts)

**Files:**
- Modify: `src/tools/index.ts` (import 8-16·19-26행, registry 배열 45-73행, export 75-103행)
- Test: `test/tools/index.test.ts` (키 목록 6-34행)

- [ ] **Step 1: registry 키 목록 테스트 갱신**

`test/tools/index.test.ts`의 `expect(Object.keys(tools).sort()).toEqual([...])` 배열에 알파벳 순서로 두 키 삽입:
- `'get_expanded_schedules'` — `'get_event_details'`와 `'get_foremost_event'` 사이
- `'get_expanded_todos'` — `'get_done_todos'`와 `'get_event_details'` 사이

정렬 후 해당 구간:
```typescript
      'get_done_todos',
      'get_expanded_todos',
      'get_event_details',
      'get_expanded_schedules',
      'get_foremost_event',
```

> 주의: `sort()`는 사전순이라 `get_event_details` < `get_expanded_schedules`/`_todos` < `get_foremost_event`이고, `get_expanded_schedules` < `get_expanded_todos`. 최종 순서를 사전순으로 정확히 맞춰라 (`get_done_todos` < `get_event_details` < `get_expanded_schedules` < `get_expanded_todos` < `get_foremost_event`):
```typescript
      'get_done_todos',
      'get_event_details',
      'get_expanded_schedules',
      'get_expanded_todos',
      'get_foremost_event',
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tools/index.test.ts`
Expected: FAIL — registry에 두 tool 미등록이라 키 목록 불일치.

- [ ] **Step 3: index.ts에 등록**

(a) schedule import 블록(8-16행)에 `getExpandedSchedules` 추가:
```typescript
import {
  branchScheduleRepeating,
  createSchedule,
  deleteSchedule,
  excludeScheduleOccurrence,
  getExpandedSchedules,
  getSchedules,
  replaceScheduleOccurrence,
  updateSchedule,
} from './scheduleTools.js'
```

(b) todo import 블록(19-26행)에 `getExpandedTodos` 추가:
```typescript
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getExpandedTodos,
  getTodos,
  replaceTodo,
  updateTodo,
} from './todoTools.js'
```

(c) `buildRegistry([...])` 배열에 추가 (알파벳 정렬 위치):
```typescript
  getDoneTodos as AnyToolDefinition,
  getEventDetails as AnyToolDefinition,
  getExpandedSchedules as AnyToolDefinition,
  getExpandedTodos as AnyToolDefinition,
  getForemostEvent as AnyToolDefinition,
```

(d) 하단 `export { ... }` 블록에도 동일 위치 삽입:
```typescript
  getDoneTodos,
  getEventDetails,
  getExpandedSchedules,
  getExpandedTodos,
  getForemostEvent,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/tools/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/index.ts test/tools/index.test.ts
git commit -m "[#69] expanded tool 2종 registry 등록 (27 → 29)"
```

---

## Task 5: 기존 조회 tool description 디마케팅

**Files:**
- Modify: `src/tools/scheduleTools.ts` (`getSchedules` description, 34-37행)
- Modify: `src/tools/todoTools.ts` (`getTodos` description range mode 줄 + 88행)
- Test: `test/tools/getSchedules.test.ts` / `test/tools/getTodos.test.ts` (description matcher 보강)

유도는 양방향이어야 효과 — expanded는 Task 2/3에서 끌어당기는 문구를 넣었고, 여기서 기존 tool이 같은 질의를 밀어내도록 좁힌다.

- [ ] **Step 1: 기존 description 테스트에 디마케팅 문구 단언 추가**

`test/tools/getSchedules.test.ts`의 `metadata` 테스트에 추가:
```typescript
    expect(getSchedules.description).toMatch(/get_expanded_schedules/)
    expect(getSchedules.description).toMatch(/does not expand|raw origin/i)
```

`test/tools/getTodos.test.ts`의 metadata 테스트(없으면 추가)에:
```typescript
    expect(getTodos.description).toMatch(/get_expanded_todos/)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/tools/getSchedules.test.ts test/tools/getTodos.test.ts`
Expected: FAIL — description에 expanded 언급 없음.

- [ ] **Step 3: description 수정**

`scheduleTools.ts`의 `getSchedules` description 첫 문단을 교체:
```typescript
  description: `\
List / fetch / show / get schedules (calendar events / appointments / meetings) for the authenticated user whose origin event_time overlaps a time range [lower, upper] (ISO 8601 with offset).

This returns ONLY raw origin events — repeating schedules come back with their recurrence rule and are NOT expanded to actual occurrence dates. If you need the real dates a recurring schedule falls on ("what's on my calendar today / this week / on date X"), use get_expanded_schedules instead. Use this tool when you want the origin rule/metadata itself (e.g. to edit the series).

All input time fields are ISO 8601 strings WITH timezone offset (e.g. "2026-05-22T10:00:00+09:00") — the server converts to Unix seconds. In responses, every absolute-time field has a sibling \`*_iso\` field (UTC ISO; for \`allday\`, a YYYY-MM-DD local date). Raw Unix-second fields are preserved alongside. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). 'exclude_repeatings' lists occurrence start timestamps that have been removed from the recurrence.`,
```

`todoTools.ts`의 `getTodos` description에서 range mode 줄(88행)을 교체하고, 그 아래 한 줄 추가. 기존:
```typescript
  - 'range': todos whose event_time falls within [lower, upper] (ISO 8601 with offset) — use for "todos today / this week / on date X"
```
교체 후:
```typescript
  - 'range': time-bound todos whose ORIGIN event_time falls within [lower, upper] (ISO 8601 with offset) — returns raw origin rules only, NOT expanded recurrences. For the real dates a repeating todo lands on, use get_expanded_todos instead.
```

- [ ] **Step 4: 전체 tool 테스트 통과 확인**

Run: `npx vitest run test/tools/`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/tools/scheduleTools.ts src/tools/todoTools.ts test/tools/getSchedules.test.ts test/tools/getTodos.test.ts
git commit -m "[#69] 기존 조회 tool description 디마케팅 — 반복 전개 질의를 expanded로 유도"
```

---

## Task 6: integration 테스트 (emulator E2E)

**Files:**
- Create: `test/integration/expanded.test.ts`
- 참조: `test/integration/schedule.test.ts` (setup 헬퍼 `_setup/*` 사용 패턴)

> emulator + Functions 레포가 떠 있어야 통과. `npm run test:integration`은 작업자가 로컬에서 수동 실행 (CI 미연동).

- [ ] **Step 1: E2E 테스트 작성**

`test/integration/schedule.test.ts`의 import·setup(`makeAuth`/base url/scope 헤더 구성)을 그대로 따른다. 다음 케이스를 작성:

```typescript
// 1) 반복 schedule 생성 → /expanded 호출 시 occurrences가 turn별로 전개되는지
//    - create_schedule로 every_day 반복 1개 생성
//    - get_expanded_schedules로 7일 window 조회
//    - occurrences.length >= 7, 각 turn 증가, events[origin] 존재 단언
// 2) 1년 초과 window → 400 (InvalidParameter → ToolError)
// 3) scope 없는 토큰 → InsufficientScope
// 4) cursor 이어받기: limit=3으로 첫 페이지 → next_cursor로 다음 페이지, occurrence 비중복
```

(구체 구현은 `schedule.test.ts`의 호출 헬퍼 시그니처에 맞춰 작성 — 그 파일의 create/get 호출 패턴을 복제하고 위 단언을 채운다.)

- [ ] **Step 2: 실행 (수동)**

Run: `npm run test:integration -- expanded`
Expected: emulator 떠 있으면 PASS. (emulator 미기동이면 SKIP/실패 — 환경 문제이지 코드 실패 아님.)

- [ ] **Step 3: Commit**

```bash
git add test/integration/expanded.test.ts
git commit -m "[#69] expanded E2E — 전개·cursor·window cap·scope (emulator)"
```

---

## Task 7: 문서 갱신

**Files:**
- Modify: `README.md` (tool 수 / 목록)
- Modify: `CLAUDE.md` (Project status 줄: "27개 tool")

- [ ] **Step 1: CLAUDE.md tool 수 갱신**

`## Project status` 첫 줄 `27개 tool 구현 (foremost event 3종 추가 — #66)` → `29개 tool 구현 (expanded occurrence 조회 2종 추가 — #69)`로. 한 절 추가: "기간 조회 시 반복 전개가 필요하면 `get_expanded_{todos,schedules}` (occurrence 단위, Functions #244), 원본 규칙 메타만 필요하면 기존 `get_{todos,schedules}`."

- [ ] **Step 2: README.md 갱신**

README에 tool 목록/카운트가 있으면 expanded 2종 추가하고 수를 29로. (위치는 README 구조에 맞춰.)

- [ ] **Step 3: 전체 검증**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: typecheck 0 error / 단위 전체 PASS / lint 0 error.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "[#69] 문서 — tool 수 29 갱신 + expanded vs 원본 조회 용도 구분"
```

---

## Self-Review 체크 결과

- **Spec(이슈 #69) 커버리지**: 신규 tool 2종(Task 2·3) / input schema lower·upper·limit·cursor(Task 2·3) / output 정규화 스키마(Task 2·3) / augmentIso 무수정 재사용(Task 2·3 테스트로 검증) / registry(Task 4) / description 양방향 유도(Task 2·3 끌어당김 + Task 5 밀어냄) / turn number↔string 함정 안내(Task 3 description) / exclude turn 미소비 안내(Task 1 occurrenceSchema description) / 1년 cap 안내(Task 2·3 input description) / 테스트·문서(Task 6·7). 모두 매핑됨.
- **Placeholder**: Task 6 integration만 "schedule.test.ts 패턴 복제"로 위임 — emulator 헬퍼 시그니처가 그 파일에 종속이라 의도적. 나머지 코드 스텝은 전량 실제 코드.
- **Type 일관성**: `occurrenceSchema`(Task 1) → Task 2·3에서 동일 이름 import. tool export 이름 `getExpandedSchedules`/`getExpandedTodos`가 Task 2·3·4 전체에서 일치. registry 키 `get_expanded_schedules`/`get_expanded_todos`가 Task 3·4 일치.
- **미해결**: Functions swagger에서 `occurrences[].turn`이 number인지 최종 확인(이슈 #69 미해결 항목) — Task 2/3 단위는 number 가정. 실제 string이면 occurrenceSchema의 `turn` 타입만 조정.
