# tools/list 페이로드 다이어트 구현 계획 (#73)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/list` 페이로드를 ~42k 토큰 → ~10k 토큰으로 줄인다. 탐색(tools/list)은 얇게, 딥한 정보는 실제 사용 시점에 `describe_tool`로 제공.

**Architecture:** (1) 문서화 전용인 outputSchema를 tools/list에서 미송신, (2) 각 tool의 긴 description을 신설 `ToolDefinition.docs` 필드로 이동하고 description은 1–3문장으로 슬림화, (3) `describe_tool({name})` 메타툴이 docs + full input/output JSON Schema를 온디맨드 반환, (4) ISO 시간 정책·discriminator·CONFIRM 플로우 공통 보일러플레이트는 MCP server `instructions`(initialize 응답)로 1회 서술.

**Tech Stack:** TypeScript, zod v4 (`z.toJSONSchema`), `@modelcontextprotocol/sdk` (Server options `instructions` 지원 확인됨), vitest.

## 측정 기준선 (2026-07-12, scratchpad measure.ts)

| 구성 | chars | 토큰 추정 |
|---|---|---|
| outputSchema | 113,599 | ~28,400 |
| inputSchema | 31,077 | ~7,800 |
| description | 20,738 | ~5,200 |
| **합계 (29 tools)** | **167,455** | **~42,000** |

측정 스크립트: `/private/tmp/claude-501/-Users-sudo-park-Documents-codebase-TodoCalendar-mcp/648e491a-ad93-4bef-b5eb-b389e323f103/scratchpad/measure.ts` (세션 소멸 대비 — Task 5에서 `scripts/measure-toollist.ts`로 레포에 편입).

## Global Constraints

- **CLAUDE.md §6 raw passthrough 불변**: `tool.execute`는 여전히 `outputSchema.parse(result)` 금지. zod outputSchema는 ToolDefinition에 그대로 유지 — describe_tool의 문서 소스로 역할이 이동할 뿐.
- **userId는 auth에서만** (§3) — describe_tool도 args의 userId 무시 (읽지도 않음).
- **lib export 면은 additive만**: `ToolDefinition.docs` 추가, `describe_tool`·`usageInstructions` export 추가 — 기존 시그니처 변경 금지. semver **minor** (0.2.3 → 0.3.0, publish는 사용자 수동).
- **자동 포맷 금지**: `prettier --write`/`eslint --fix` 실행 금지. 검증은 `npm run lint`/`format:check`만.
- 커밋 메시지는 `[#73]` prefix + 앵커 단위 불릿. 머지는 사용자 승인 후 rebase merge.
- 모든 신규 위임 텍스트(description/docs/instructions)는 영어 (기존 tool 텍스트와 동일).

---

### Task 1: JSON Schema 변환 헬퍼를 tools/shared로 분리 + tools/list에서 outputSchema 미송신

**Files:**
- Create: `src/tools/shared/jsonSchema.ts`
- Create: `test/tools/shared/jsonSchema.test.ts`
- Modify: `src/mcp/toolSchema.ts` (대폭 축소)
- Modify: `test/mcp/toolSchema.test.ts`
- Modify: `test/mcp/server.test.ts:134-151` (outputSchema 노출 테스트 2건 교체)

**Interfaces:**
- Produces: `toInputJsonSchema(zod: z.ZodType): Record<string, unknown>` — io:'input' + $schema strip + root union 시 throw. `toDocJsonSchema(zod: z.ZodType): Record<string, unknown>` — $schema strip + additionalProperties/unevaluatedProperties `false → {}` 완화, root 제약 없음 (array root 허용). Task 3의 describe_tool이 둘 다 소비.
- 배경: tools/ → mcp/ 방향 import는 단방향 의존성 위반이라, mcp/toolSchema의 순수 변환 로직을 tools/shared로 내리고 mcp/toolSchema가 이를 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/tools/shared/jsonSchema.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toDocJsonSchema, toInputJsonSchema } from '../../../src/tools/shared/jsonSchema.js'

describe('toInputJsonSchema', () => {
  it('transform 스키마 — pre-transform(input) side 노출, $schema 제거', () => {
    const schema = z.object({ at: z.iso.datetime({ offset: true }).transform(() => 1) })
    const json = toInputJsonSchema(schema)
    expect(json['$schema']).toBeUndefined()
    const at = (json['properties'] as Record<string, Record<string, unknown>>)['at']
    expect(at?.['type']).toBe('string')
  })

  it('root oneOf/anyOf/allOf — throw (Anthropic API가 tools[*].input_schema에서 거부)', () => {
    expect(() => toInputJsonSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))).toThrow(
      /root/,
    )
  })
})

describe('toDocJsonSchema', () => {
  it('additionalProperties:false → {} 완화 (raw passthrough 문서화)', () => {
    const json = toDocJsonSchema(z.strictObject({ a: z.string() }))
    expect(json['additionalProperties']).toEqual({})
  })

  it('array root 허용 (MCP outputSchema 제약과 무관한 문서 채널)', () => {
    const json = toDocJsonSchema(z.array(z.object({ a: z.string() })))
    expect(json['type']).toBe('array')
  })

  it('중첩 intersection의 unevaluatedProperties:false도 완화', () => {
    const json = toDocJsonSchema(
      z.object({ merged: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })) }),
    )
    expect(JSON.stringify(json)).not.toContain('"unevaluatedProperties":false')
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- test/tools/shared/jsonSchema.test.ts` → FAIL (module not found)

- [ ] **Step 3: 구현** — `src/tools/shared/jsonSchema.ts` (기존 `src/mcp/toolSchema.ts:8-53`의 stripMeta/relaxAdditional/assertNoRootUnion/변환 로직을 이동, 주석 포함)

```ts
import { z } from 'zod'

type JsonObject = Record<string, unknown>

const stripMeta = (json: JsonObject): JsonObject => {
  const { $schema, ...rest } = json
  void $schema
  return rest
}

// Raw passthrough: openAPI may add fields beyond what zod declares — schemas shown to
// the LLM must not claim `additionalProperties: false` (and the equivalent
// `unevaluatedProperties: false` JSON Schema 2020-12 emits for allOf/intersection
// branches). Recursively relax both to `{}` (allow anything).
const relaxAdditional = (json: unknown): unknown => {
  if (Array.isArray(json)) return json.map(relaxAdditional)
  if (typeof json !== 'object' || json === null) return json
  const out: JsonObject = {}
  for (const [k, v] of Object.entries(json)) {
    if ((k === 'additionalProperties' || k === 'unevaluatedProperties') && v === false) {
      out[k] = {}
    } else out[k] = relaxAdditional(v)
  }
  return out
}

const ROOT_UNION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const

// Anthropic API: tools[*].input_schema root에 oneOf/allOf/anyOf 불허 — ListTools forward
// 되는 모든 turn에서 400으로 세션 전체 먹통. dev 시점에 throw로 회귀 차단.
const assertNoRootUnion = (json: JsonObject): void => {
  const present = ROOT_UNION_KEYS.filter((k) => k in json)
  if (present.length === 0) return
  throw new Error(
    `tool inputSchema must not have root ${present.join('/')} — Anthropic API rejects ` +
      `tools[*].input_schema with top-level oneOf/anyOf/allOf. Flatten to a single object schema.`,
  )
}

// io: 'input' — transform schemas expose pre-transform (input) side for JSON Schema.
// Required because input schemas may contain ISO→ts transforms.
export const toInputJsonSchema = (zod: z.ZodType): JsonObject => {
  const json = stripMeta(z.toJSONSchema(zod, { io: 'input' }) as JsonObject)
  assertNoRootUnion(json)
  return json
}

// describe_tool 문서 채널용 output 변환 — MCP tools/list outputSchema 제약(root object)과
// 무관하므로 array root도 그대로 노출. 검증에 쓰이지 않는 순수 문서.
export const toDocJsonSchema = (zod: z.ZodType): JsonObject =>
  relaxAdditional(stripMeta(z.toJSONSchema(zod) as JsonObject)) as JsonObject
```

- [ ] **Step 4: `src/mcp/toolSchema.ts` 축소** — outputSchema 미송신 (#73 핵심 커밋)

```ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { toInputJsonSchema } from '../tools/shared/jsonSchema.js'
import type { AnyToolDefinition } from '../tools/index.js'

// outputSchema는 tools/list에 싣지 않는다 (#73) — 문서화 전용 채널(§6)인데 페이로드의
// 68%를 차지했음. 응답 모양 힌트는 describe_tool 메타툴이 온디맨드로 제공한다.
// zod outputSchema 자체는 ToolDefinition에 유지 — describe_tool의 문서 소스.
export const toMcpTool = (def: AnyToolDefinition): Tool => ({
  name: def.name,
  description: def.description,
  inputSchema: toInputJsonSchema(def.inputSchema) as Tool['inputSchema'],
})
```

- [ ] **Step 5: 기존 테스트 정리**
  - `test/mcp/toolSchema.test.ts`: `toMcpInputSchema` import를 제거하고 input 변환 케이스(transform io:input, root union throw)는 Step 1의 jsonSchema.test.ts가 흡수했으므로 삭제. outputSchema 관련 케이스(root anyOf silently drop, object 노출, array 미노출, relax 2건, intersection)를 전부 삭제하고 아래로 교체:

```ts
it('outputSchema 미송신 — 문서 채널은 describe_tool (#73)', () => {
  const def = stub({ outputSchema: z.object({ a: z.string() }) }) as AnyToolDefinition
  const tool = toMcpTool(def)
  expect(tool.outputSchema).toBeUndefined()
})
```

  - `test/mcp/server.test.ts:134-151` 두 케이스(`array output 가진 tool은 outputSchema 없음`, `object output 가진 tool은 outputSchema 노출`)를 한 케이스로 교체:

```ts
it('모든 tool — outputSchema 미송신 (#73 다이어트)', async () => {
  const { client } = await wireServer()
  const { tools } = await client.listTools()
  for (const tool of tools) expect(tool.outputSchema).toBeUndefined()
})
```

- [ ] **Step 6: 전체 확인** — `npm test && npm run typecheck && npm run lint` → PASS
- [ ] **Step 7: Commit**

```bash
git add src/tools/shared/jsonSchema.ts src/mcp/toolSchema.ts test/
git commit -m "[#73] tools/list에서 outputSchema 미송신 — 페이로드 68% 차지하던 문서 전용 채널 제거

- tools/shared/jsonSchema — zod→JSON Schema 순수 변환(toInputJsonSchema/toDocJsonSchema)을 mcp/toolSchema에서 내림 (tools→mcp 역방향 import 방지, describe_tool이 소비 예정)
- toMcpTool — name/description/inputSchema만 노출. zod outputSchema는 ToolDefinition에 유지 (describe_tool 문서 소스)"
```

---

### Task 2: `ToolDefinition.docs` 신설 — 긴 description을 docs로 이동, description 슬림화

**Files:**
- Modify: `src/tools/shared/tool.ts`
- Modify: `src/tools/todoTools.ts`, `src/tools/scheduleTools.ts`, `src/tools/tagTools.ts`, `src/tools/doneTodoTools.ts`, `src/tools/eventDetailTools.ts`, `src/tools/foremostEventTools.ts`
- Modify: `test/tools/index.test.ts`

**Interfaces:**
- Produces: `ToolDefinition.docs: string` (required) — 전체 사용 가이드. Task 3의 describe_tool이 반환. **description 정보는 삭제가 아니라 docs로 이동 — 무손실.**

- [ ] **Step 1: 실패하는 테스트** — `test/tools/index.test.ts:39-50`의 ToolDefinition 모양 케이스에 추가:

```ts
expect(typeof tool.docs).toBe('string')
expect(tool.docs.length).toBeGreaterThan(0)
// description은 탐색용 요약 — docs(전체 가이드)보다 길 수 없다
expect(tool.description.length).toBeLessThanOrEqual(tool.docs.length)
```

- [ ] **Step 2: 실패 확인** — `npm test -- test/tools/index.test.ts` → FAIL (docs undefined)

- [ ] **Step 3: `src/tools/shared/tool.ts`에 docs 추가**

```ts
export interface ToolDefinition<I, O> {
  readonly name: string
  /** tools/list에 노출되는 탐색용 요약 (1–3문장). 목적 + 핵심 disambiguator만. (#73) */
  readonly description: string
  /** 전체 사용 가이드 — describe_tool이 온디맨드 반환. decision guide·응답 모양·시간 정책 상세는 여기로. */
  readonly docs: string
  // ... (scopes/inputSchema/outputSchema/execute 기존 그대로)
}
```

- [ ] **Step 4: 6개 tool 파일 일괄 적용** — 각 tool object에 대해:
  1. `docs:` 필드 신설, 값은 **기존 description 전문 verbatim** (template literal 그대로 이동).
  2. `description:`을 아래 슬림 버전으로 교체.

**슬림화 규칙** (아래 명시 안 된 tool에 적용):
  - 첫 문단의 요약 1–2문장 유지.
  - 다음 보일러플레이트 문장/문단은 description에서 **삭제** (docs에는 전문이 남고, Task 4의 server instructions가 공통 서술): `All input time fields are ISO 8601 ...  preserved alongside.` / `The 'event_time' field is a tagged union ...` / `The 'repeating.option' field is a discriminated object ...` / 멀티라인 `Decision guide for the agent:` 블록 / 멀티라인 `Two-step flow:` 블록.
  - CONFIRM tool은 `CONFIRM-gated: first call returns a confirmToken — re-call with it to execute (see server instructions).` 한 줄 유지.
  - decision guide가 있던 tool은 끝에 `Call describe_tool("<name>") for the full decision guide and I/O schemas.` 한 줄 추가.

**신규 description 전문** (29개 중 보일러플레이트가 큰 tool — 이 텍스트를 그대로 사용):

| tool | 새 description |
|---|---|
| `get_todos` | `List todos (tasks) via one of three modes — 'current': non-time-bound todos that stay visible until completed; 'range': todos whose ORIGIN event_time falls in [lower, upper] (raw origin rules only, NOT expanded — use get_expanded_todos for actual recurrence dates); 'uncompleted': still-open todos as of refTime (overdue lookups).` |
| `get_expanded_todos` | `List time-bound todos over [lower, upper] with repeating todos EXPANDED to their actual occurrence dates (server-computed). Use this instead of get_todos mode="range" whenever real recurrence dates matter. Paginated via cursor; window <= 1 year. Call describe_tool("get_expanded_todos") for the normalized events/occurrences response shape and turn-advancement rules.` |
| `create_todo` | `Create a new todo for the authenticated user. Omit 'event_time' to create a 'current' (non-time-bound) todo that stays visible until completed. Returns the created todo with its uuid.` |
| `update_todo` | `Partially update a todo (PATCH) — only the fields you provide are applied. Returns the full updated todo.` |
| `complete_todo` | `Mark a todo as completed. Pass 'origin' = the full todo payload from get_todos verbatim (keep raw Unix-second timestamps — do NOT convert to ISO). For repeating todos, optionally advance to the next occurrence via next_event_time / next_repeating_turn — call describe_tool("complete_todo") for details.` |
| `replace_todo` | `Replace a repeating todo with a new one: set 'origin_next_event_time' to advance the origin past this turn, or omit it to delete the origin entirely. For non-repeating todos use update_todo instead. Call describe_tool("replace_todo") for the occurrence-vs-series decision guide.` |
| `delete_todo` | `Permanently delete a todo — for repeating todos this removes the ENTIRE series. CONFIRM-gated: first call returns a confirmToken — re-call with it to execute (see server instructions). Call describe_tool("delete_todo") for alternatives that keep the series (replace/skip one occurrence).` |
| `get_schedules` | `List schedules (calendar events) whose ORIGIN event_time overlaps [lower, upper] — raw origin rules only, recurrences NOT expanded. Use get_expanded_schedules for the actual dates recurring events fall on; use this tool to read/edit the series definition itself.` |
| `get_expanded_schedules` | `List schedules over [lower, upper] with repeating events EXPANDED to their actual occurrence dates (server-computed) — use for "what's on my calendar today / this week". Paginated via cursor; window <= 1 year. Call describe_tool("get_expanded_schedules") for the normalized events/occurrences response shape.` |
| `create_schedule` | `Create a new schedule (calendar event) for the authenticated user. Unlike todos, 'event_time' is required. Returns the created schedule with its uuid.` |
| `update_schedule` | `Partially update a schedule (PATCH) — only the fields you provide are applied. Note: recurrence-rule changes apply globally (past occurrences too); to change the rule only from a point onward use branch_schedule_repeating.` |
| `exclude_schedule_occurrence` | `Skip (cancel) a single occurrence of a repeating schedule; the rest of the recurrence continues. To replace the occurrence with a one-off use replace_schedule_occurrence; to change the rule going forward use branch_schedule_repeating.` |
| `replace_schedule_occurrence` | `Replace a single occurrence of a repeating schedule with a one-off schedule (the origin recurrence continues for other slots). Returns updated_origin and new_schedule. To merely skip the slot use exclude_schedule_occurrence.` |
| `branch_schedule_repeating` | `Cut a repeating schedule at 'end_time' and start a new schedule from there — past occurrences stay on the origin. Use when the recurrence rule changes from a point onward. Call describe_tool("branch_schedule_repeating") for the decision guide vs update/replace/exclude.` |
| `delete_schedule` | `Permanently delete a schedule including all repeating occurrences. CONFIRM-gated: first call returns a confirmToken — re-call with it to execute (see server instructions). Call describe_tool("delete_schedule") for smaller-scope alternatives (skip/replace/branch one part).` |

나머지 14개 (tag/doneTodo/eventDetail/foremost 계열): 기존 description이 이미 짧으므로 위 슬림화 규칙의 보일러플레이트 삭제만 적용 (삭제할 게 없으면 description 유지, docs = 동일 텍스트).

- [ ] **Step 5: 파일별 커밋** (todoTools → scheduleTools → 나머지 4파일 순, 각 커밋 전 `npm test -- test/tools` PASS 확인)

```bash
git add src/tools/shared/tool.ts src/tools/todoTools.ts test/tools/index.test.ts
git commit -m "[#73] ToolDefinition.docs 신설 + todo tools description 슬림화

- ToolDefinition.docs — 전체 가이드 채널 (describe_tool이 반환 예정), description은 탐색용 요약으로 축소
- todoTools 7종 — 기존 description 전문을 docs로 무손실 이동, description은 목적+disambiguator 1–3문장"
# 이후 scheduleTools/tagTools/doneTodoTools/eventDetailTools/foremostEventTools 동일 패턴 커밋
```

---

### Task 3: `describe_tool` 메타툴

**Files:**
- Create: `src/tools/describeTool.ts`
- Create: `test/tools/describeTool.test.ts`
- Modify: `src/tools/index.ts` (registry 등록 + export)
- Modify: `test/tools/index.test.ts` (registry 목록·scope 매핑 예외)
- Modify: `test/mcp/server.test.ts` (tools/list 목록에 describe_tool 추가 + E2E 케이스)

**Interfaces:**
- Consumes: `toInputJsonSchema` / `toDocJsonSchema` (Task 1), `ToolDefinition.docs` (Task 2)
- Produces: registry 키 `describe_tool`. 응답 `{ name, docs, scopes, input_schema, output_schema }`. lib에서 `createDescribeTool` export하지 않음 — registry 경유로만 노출 (export 면 최소 유지).

- [ ] **Step 1: 실패하는 테스트** — `test/tools/describeTool.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { tools } from '../../src/tools/index.js'
import type { Auth } from '../../src/auth/types.js'

const auth: Auth = { userId: 'u-test', scopes: ['read:calendar'] }
const describeTool = tools['describe_tool']!

describe('describe_tool', () => {
  it('알려진 tool — docs·scopes·input/output JSON Schema 반환', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_expanded_todos' })) as {
      name: string
      docs: string
      scopes: string[]
      input_schema: Record<string, unknown>
      output_schema: Record<string, unknown>
    }
    expect(result.name).toBe('get_expanded_todos')
    expect(result.docs).toBe(tools['get_expanded_todos']!.docs)
    expect(result.scopes).toEqual(['read:calendar'])
    expect(result.input_schema['type']).toBe('object')
    expect(result.output_schema['type']).toBe('object')
  })

  it('array output tool — output_schema는 array root 그대로 (MCP 제약 무관 문서 채널)', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_tags' })) as {
      output_schema: Record<string, unknown>
    }
    expect(result.output_schema['type']).toBe('array')
  })

  it('자기 자신도 describe 가능', async () => {
    const result = (await describeTool.execute(auth, { name: 'describe_tool' })) as { name: string }
    expect(result.name).toBe('describe_tool')
  })

  it('모르는 tool — ToolError 404 NotFound', async () => {
    await expect(describeTool.execute(auth, { name: 'nope' })).rejects.toMatchObject({
      status: 404,
      code: 'NotFound',
    })
  })

  it('input_schema는 pre-transform(ISO 문자열) side — epoch number가 아님', async () => {
    const result = (await describeTool.execute(auth, { name: 'get_schedules' })) as {
      input_schema: { properties: Record<string, Record<string, unknown>> }
    }
    expect(result.input_schema.properties['lower']?.['type']).toBe('string')
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- test/tools/describeTool.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/tools/describeTool.ts`

```ts
import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { ToolError } from './shared/errors.js'
import { toDocJsonSchema, toInputJsonSchema } from './shared/jsonSchema.js'
import type { AnyToolDefinition, ToolDefinition } from './shared/tool.js'

const describeToolInput = z
  .object({
    name: z.string().min(1).describe('Tool name exactly as it appears in tools/list.'),
  })
  .describe('Look up the full documentation for one tool by name.')

type DescribeToolInput = z.infer<typeof describeToolInput>

const describeToolOutput = z
  .object({
    name: z.string(),
    docs: z
      .string()
      .describe('Full usage guide: behavior, decision guides vs sibling tools, response-shape notes.'),
    scopes: z.array(z.string()).describe('OAuth scopes required to invoke the tool.'),
    input_schema: z
      .record(z.string(), z.unknown())
      .describe('Complete JSON Schema for the tool arguments (pre-transform, ISO datetime strings).'),
    output_schema: z
      .record(z.string(), z.unknown())
      .describe(
        'JSON Schema of the response for interpretation only — actual payloads are raw openAPI passthrough and may include extra fields.',
      ),
  })
  .describe('Full documentation for one tool.')

type DescribeToolOutput = z.infer<typeof describeToolOutput>

const DESCRIPTION = `\
Get the full documentation for any tool on this server: complete usage guide, decision guides \
vs sibling tools, and full input/output JSON Schemas. Tool descriptions in tools/list are \
intentionally brief — call this before first use of an unfamiliar tool, especially mutations \
or repeating-event flows.`

// registry가 자기 자신(describe_tool 포함)을 참조해야 하므로 lazy getter 주입 —
// index.ts에서 `createDescribeTool(() => tools)`로 생성 (모듈 순환 없이 지연 해소).
export const createDescribeTool = (
  getRegistry: () => Readonly<Record<string, AnyToolDefinition>>,
): ToolDefinition<DescribeToolInput, DescribeToolOutput> => ({
  name: 'describe_tool',
  scopes: ['read:calendar'],
  description: DESCRIPTION,
  docs: DESCRIPTION,
  inputSchema: describeToolInput,
  outputSchema: describeToolOutput,
  execute: async (_auth: Auth, args: unknown): Promise<DescribeToolOutput> => {
    const { name } = describeToolInput.parse(args)
    const def = getRegistry()[name]
    if (def === undefined) {
      throw new ToolError(404, 'NotFound', `Unknown tool: ${name}. Use the names listed in tools/list.`)
    }
    return {
      name: def.name,
      docs: def.docs,
      scopes: [...def.scopes],
      input_schema: toInputJsonSchema(def.inputSchema),
      output_schema: toDocJsonSchema(def.outputSchema),
    }
  },
})
```

- [ ] **Step 4: registry 등록** — `src/tools/index.ts`

```ts
import { createDescribeTool } from './describeTool.js'
// buildRegistry 정의 아래:
const describeTool = createDescribeTool(() => tools)
export const tools = buildRegistry([
  // 기존 29개 그대로 +
  describeTool,
])
```

(개별 named export 블록에는 describeTool 추가하지 않음 — registry 경유 노출만.)

- [ ] **Step 5: 기존 테스트 갱신**
  - `test/tools/index.test.ts:6-36` 정렬 목록에 `'describe_tool'` 추가 (알파벳 순서상 `'delete_todo'` 다음, `'exclude_schedule_occurrence'` 앞).
  - `test/tools/index.test.ts:52-57` scope 매핑 케이스에 메타툴 예외:

```ts
const expected =
  key === 'describe_tool' || key.startsWith('get_') ? 'read:calendar' : 'write:calendar'
```

  - `test/mcp/server.test.ts:91-121` tools/list 목록에 `'describe_tool'` 추가.
  - `test/mcp/server.test.ts`에 transport E2E 케이스 추가:

```ts
it('describe_tool — MCP 경유 full docs 반환, 모르는 이름은 NotFound', async () => {
  const { client } = await wireServer()

  const ok = await client.callTool({ name: 'describe_tool', arguments: { name: 'delete_todo' } })
  expect(ok.isError).toBeFalsy()
  const payload = ok.structuredContent as { docs: string; input_schema: Record<string, unknown> }
  expect(payload.docs).toContain('confirmToken')
  expect(payload.input_schema['type']).toBe('object')

  const missing = await client.callTool({ name: 'describe_tool', arguments: { name: 'nope' } })
  expect(missing.isError).toBe(true)
  expect(missing._meta).toEqual({ code: 'NotFound', status: 404 })
})
```

- [ ] **Step 6: 전체 확인** — `npm test && npm run typecheck && npm run lint` → PASS
- [ ] **Step 7: Commit**

```bash
git add src/tools/describeTool.ts src/tools/index.ts test/
git commit -m "[#73] describe_tool 메타툴 — tool별 딥 문서(docs + full I/O JSON Schema) 온디맨드 조회

- createDescribeTool — lazy registry getter 주입으로 자기참조 해소, 미등록 이름은 404 NotFound
- output_schema는 toDocJsonSchema 경유 — MCP root-object 제약 없이 array root도 문서로 노출
- registry에 describe_tool 등록 (read:calendar) — MCP·aiFrontAPI 두 경로 모두 노출"
```

---

### Task 4: 공통 usage instructions — MCP server `instructions` 주입 + lib export

**Files:**
- Create: `src/tools/instructions.ts`
- Modify: `src/tools/index.ts` (re-export)
- Modify: `src/mcp/server.ts:63` (Server options)
- Modify: `test/mcp/server.test.ts`

**Interfaces:**
- Produces: `usageInstructions: string` — `todocalendar-tools/tools`에서 import 가능 (aiFrontAPI가 시스템 프롬프트에 붙일 수 있게). MCP 경로는 initialize 응답 `instructions`로 자동 전달.

- [ ] **Step 1: 실패하는 테스트** — `test/mcp/server.test.ts`에 추가:

```ts
it('initialize instructions — 공통 시간 정책·describe_tool 안내 노출 (#73)', async () => {
  const { client } = await wireServer()
  const instructions = client.getInstructions()
  expect(instructions).toContain('ISO 8601')
  expect(instructions).toContain('describe_tool')
  expect(instructions).toContain('confirmToken')
})
```

- [ ] **Step 2: 실패 확인** — `npm test -- test/mcp/server.test.ts` → FAIL (undefined)

- [ ] **Step 3: 구현** — `src/tools/instructions.ts`

```ts
// tools/list description 슬림화(#73)로 tool별 반복 서술을 제거한 공통 정책.
// MCP 경로: initialize 응답 instructions. first-party(aiFrontAPI): 이 상수를 import해
// 시스템 프롬프트에 포함 (Functions repo 후속).
export const usageInstructions = `\
TodoCalendar MCP usage guide (applies to every tool):

- Time inputs: every absolute-time input field is an ISO 8601 string WITH timezone offset \
(e.g. "2026-05-22T10:00:00+09:00"). The server converts to Unix seconds — never compute epoch \
numbers yourself.
- Time outputs: responses keep raw Unix-second fields and add a sibling \`*_iso\` field for each \
(UTC ISO; for \`allday\` times, a YYYY-MM-DD local date). When a tool asks you to echo a previous \
response back (e.g. complete_todo 'origin', get_done_todos 'cursor'), pass the raw payload \
verbatim — do NOT convert its timestamps to ISO.
- \`event_time\` is a tagged union discriminated by \`time_type\` ('at' | 'period' | 'allday'). \
\`repeating.option\` is discriminated by \`optionType\`.
- CONFIRM-gated tools (delete_todo, delete_schedule): the first call does NOT mutate — it returns \
{ status: 'confirm_required', message, confirmToken }. Surface \`message\` to the end user; on \
approval re-call with the SAME arguments plus confirmToken (expires in 5 minutes, bound to \
user + tool + args).
- Tool descriptions in tools/list are intentionally brief. Before first use of an unfamiliar \
tool — especially mutations or repeating-event flows — call \`describe_tool\` with the tool name \
to get its full usage guide and complete input/output JSON Schemas.
- Repeating events: get_todos / get_schedules return raw origin rules only (NOT expanded). For \
the actual dates occurrences fall on, use get_expanded_todos / get_expanded_schedules.`
```

`src/tools/index.ts`에 `export { usageInstructions } from './instructions.js'` 추가.

`src/mcp/server.ts:63`:

```ts
const server = new Server(info, { capabilities: { tools: {} }, instructions: usageInstructions })
```

(+ import: `import { usageInstructions } from '../tools/instructions.js'`)

- [ ] **Step 4: 통과 확인** — `npm test && npm run typecheck && npm run lint` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/tools/instructions.ts src/tools/index.ts src/mcp/server.ts test/mcp/server.test.ts
git commit -m "[#73] 공통 usage instructions — tool별 반복 보일러플레이트를 initialize instructions로 1회 서술

- usageInstructions — ISO 입출력 정책·discriminator·CONFIRM 플로우·describe_tool 안내. lib export로 aiFrontAPI 시스템 프롬프트 재사용 대비
- createMcpServer — Server options에 instructions 주입"
```

---

### Task 5: 측정 스크립트 편입 + 문서 갱신 + 절감 수치 기록

**Files:**
- Create: `scripts/measure-toollist.ts` (scratchpad measure.ts를 레포 경로 import로 정리한 것 — 위 "측정 기준선" 참조)
- Modify: `CLAUDE.md` (Project status "29개 tool" → describe_tool 포함 30개, §6에 outputSchema 미송신·describe_tool 채널 반영)
- Modify: `README.md:39-46` (tool 수·테이블에 `describe_tool` 행 추가)

- [ ] **Step 1: 측정 스크립트 편입** — `scripts/measure-toollist.ts` 생성 (`npx tsx scripts/measure-toollist.ts`로 실행, import 경로는 `../src/tools/index.js` / `../src/mcp/toolSchema.js`. desc/input/total 컬럼 — output 컬럼은 미송신이므로 제거)
- [ ] **Step 2: 측정 실행** — `npx tsx scripts/measure-toollist.ts` → 총 chars/토큰 확인. **기대: 총 ~40k chars(≈10k 토큰) 이하.** 초과 시 description 슬림화 누락 tool을 찾아 Task 2 규칙 재적용.
- [ ] **Step 3: CLAUDE.md §6 갱신** — "outputSchema는 문서화 채널 전용" 문단에 반영: outputSchema는 tools/list에 싣지 않고 describe_tool이 온디맨드 반환, description은 탐색용 요약·docs가 전체 가이드, 공통 정책은 usageInstructions. `outputSchema.parse()` 금지 원칙은 그대로 유지.
- [ ] **Step 4: README tool 테이블에 meta 카테고리(`describe_tool`) 행 추가 + "29개" → "30개 (describe_tool 메타툴 포함)"**
- [ ] **Step 5: 최종 검증** — `npm test && npm run typecheck && npm run lint && npm run format:check` → PASS
- [ ] **Step 6: Commit + 이슈 코멘트**

```bash
git add scripts/measure-toollist.ts CLAUDE.md README.md
git commit -m "[#73] 문서 갱신 + tools/list 측정 스크립트 편입

- scripts/measure-toollist — tool별 tools/list 페이로드 측정 (회귀 감시용)
- CLAUDE.md §6 — outputSchema 미송신·describe_tool 문서 채널·usageInstructions 반영"
gh issue comment 73 --body "다이어트 결과: <before 167,455 chars(~42k tokens) → after 측정치> — 측정: npx tsx scripts/measure-toollist.ts"
```

---

## Verification (전체 완료 후)

1. `npm test` / `npm run typecheck` / `npm run lint` / `npm run format:check` 전부 PASS.
2. `npx tsx scripts/measure-toollist.ts` — 총 페이로드 ~10k 토큰 수준 확인, 이슈 #73에 before/after 기록.
3. **integration**: 로컬 Functions emulator 위에서 `npm run test:integration` (사용자 실행 — CI 없음).
4. **수동 확인** (`running-mcp-inspector` skill): Inspector에서 ① tools/list에 30개 tool + outputSchema 부재 ② initialize 응답 instructions ③ `describe_tool({name:"delete_todo"})` full docs 반환 ④ 실제 tool 호출(get_todos 등) 동작 불변.

## 후속 (이 PR 범위 밖)

- npm publish 0.3.0 + Cloud Run 배포 — 사용자 수동.
- Functions repo: aiFrontAPI 시스템 프롬프트에 `usageInstructions` 반영 이슈 생성 (description 슬림화로 얇아진 정책 텍스트 보강 + describe_tool 활용).
