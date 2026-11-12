# TodoCalendar-mcp

AI agent가 TodoCalendar의 todo / schedule / tag 데이터를 다룰 수 있게 노출하는 MCP server + npm tool library.

두 진입점, 같은 tool layer:

- **MCP server** (Streamable HTTP) — 외부 AI Agent용 (Claude Desktop 등)
- **`todocalendar-tools`** (npmjs.com, public) — first-party AI 호스트가 직접 import해서 사용

---

## Connect from Claude

*For anyone connecting the hosted server from Claude, and for directory reviewers. Everything below this section is developer documentation, in Korean.*

**1. Add the connector.** In Claude, open **Settings → Connectors → Add custom connector** and enter:

```
https://mcp.todo-calendar.com/mcp
```

**2. Sign in.** Claude redirects you to the To-do Calendar sign-in page. The consent screen lists the two scopes being requested — `read:calendar` and `write:calendar`. The connector only ever acts on the account that approved it: the user identity is read from the verified access token, never from a tool argument.

**3. Ask for something.** A few prompts that exercise the main paths:

| Prompt | Tool |
| --- | --- |
| "What's on my calendar this week?" | `get_expanded_schedules` |
| "What to-dos do I have open?" | `get_todos` |
| "Add a to-do: buy coffee beans, tomorrow 9am" | `create_todo` |
| "Move it to 10am" | `update_todo` |
| "Mark it done" | `complete_todo` |
| "Add a weekly team meeting, Mondays 10am" | `create_schedule` |
| "Skip next Monday's team meeting" | `exclude_schedule_occurrence` |
| "Delete the team meeting" | `delete_schedule` (two steps — see below) |

**Deleting takes two steps.** `delete_todo` and `delete_schedule` do not delete on the first call. The first call changes nothing and returns a confirmation message with a token; the deletion happens only when the assistant calls again with the same arguments plus that token. Tokens expire after 5 minutes and are bound to the user, the tool and the arguments, so they cannot be replayed elsewhere.

**Disconnecting.** End the connection from Claude's connector settings. The issued tokens are invalidated immediately.

### What the tools cover

30 tools. Repeating events are expanded on the server, so you get the dates each occurrence actually falls on — weekday accrual, month-end skips, leap years and lunar rules included.

| | |
| --- | --- |
| **To-dos** | list, create, edit, complete, restore, replace, delete |
| **Schedules** | list, create, edit, delete; edit or skip a single occurrence; split a repeating series |
| **Tags** | list, create, edit, delete |
| **Event details** | place, coordinates, address, link, memo |
| **Pinned event** | read, set, clear |

Every tool carries a `title` and the applicable `readOnlyHint` / `destructiveHint` in `tools/list`. `describe_tool({name})` returns the full guide and the input/output JSON Schemas for any tool.

### Privacy

[Privacy policy](https://todo-calendar.com/privacy/en) (Korean: [/privacy/ko](https://todo-calendar.com/privacy/ko)). The "Connected external apps" section covers what a connected app can reach, which tokens are stored and for how long, and how to end a connection.

This server keeps no store of its own — it forwards requests to the To-do Calendar API and passes responses straight back.

### Support

todocalendar.help@gmail.com

---

## For external AI agents

### Endpoint

```
https://mcp.todo-calendar.com/mcp
```

Streamable HTTP transport ([MCP spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) 호환).

### Auth

OAuth 2.1 **Resource Server**. Authorization Server는 별 entity — TodoCalendar Functions가 호스팅. client는 그곳에서 token 발급 후:

```
Authorization: Bearer <RS256 JWT>
```

token에 필요한 scope이 박혀 있어야 함:

- `read:calendar` — `get_*` tools
- `write:calendar` — 생성·수정·삭제 tools
- `set_foremost_event`은 둘 다 — pin 전에 대상이 할일인지 일정인지 단건 조회로 판별한다

본 server는 `GET /.well-known/oauth-protected-resource` (RFC 9728)로 AS 위치·scope 목록 공개.

### Tools

30개 (`describe_tool` 메타툴 포함). 응답은 openAPI raw passthrough — timestamp 단위 변환 없음, 필드 rename 없음.

기간 조회 시 반복 이벤트의 실제 발생일이 필요하면 `get_expanded_*` (서버가 occurrence 단위로 전개, Functions #244), 원본 규칙 메타만 필요하면 기존 `get_todos`/`get_schedules`를 쓴다.

`tools/list`는 탐색용 요약만 싣는다 (#73 다이어트 — outputSchema 미송신, description 1–3문장). tool별 전체 사용 가이드·full I/O JSON Schema는 `describe_tool({name})`으로 온디맨드 조회하고, ISO 시간 정책·discriminator·CONFIRM 플로우 같은 공통 규칙은 initialize 응답 `instructions`에 1회 서술된다.

| 도메인             | tools                                                                                                                                                                                            | CONFIRM           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **todo**           | `get_todos` / `get_expanded_todos` / `create_todo` / `update_todo` / `complete_todo` / `replace_todo` / `delete_todo`                                                                            | `delete_todo`     |
| **schedule**       | `get_schedules` / `get_expanded_schedules` / `create_schedule` / `update_schedule` / `exclude_schedule_occurrence` / `replace_schedule_occurrence` / `branch_schedule_repeating` / `delete_schedule` | `delete_schedule` |
| **tag**            | `get_tags` / `create_tag` / `update_tag` / `delete_tag`                                                                                                                   | —                 |
| **done todo**      | `get_done_todos` / `update_done_todo` / `revert_done_todo` / `delete_done_todo`                                                                                           | —                 |
| **event detail**   | `get_event_details` / `set_event_detail` / `delete_event_detail`                                                                                                          | —                 |
| **foremost event** | `get_foremost_event` / `set_foremost_event` / `clear_foremost_event`                                                                                                      | —                 |
| **meta**           | `describe_tool`                                                                                                                                                           | —                 |

상세 입출력 스키마는 `describe_tool({name})` 응답(`docs` + `input_schema` + `output_schema`) 참고.

**CONFIRM 2단계** (`delete_todo` / `delete_schedule`): 첫 호출은 destructive 동작 없이 `confirmToken`만 반환, 두 번째 호출에 token echo로 실 삭제. token은 5분 TTL이고 user+tool+args에 바인딩 — 다른 사용자·다른 args에 재사용 불가.

---

## For library consumers

`aiFrontAPI` 같은 first-party 서버사이드 AI 호스트는 MCP transport 우회하고 tool 함수를 직접 import.

### Install

npmjs.com public 패키지 — 인증·`.npmrc` 설정 일체 불필요.

```sh
npm install todocalendar-tools
```

### Use

```ts
import { tools, type Auth } from 'todocalendar-tools/tools'

// auth context는 호출자가 만든다. 본 lib은 인증 검증 안 함.
// Firebase Auth 등으로 token 검증 후 userId를 채워 넘김.
const auth: Auth = {
  userId: '<verified-user-id>',
  scopes: ['read:calendar', 'write:calendar'],
  // clientId?: OAuth client_id. dev/lib 경로는 보통 undefined.
}

const result = await tools.get_todos.execute(auth, { mode: 'current' })
```

### 호출자 책임

- **Auth context 검증**: `auth.userId`는 검증된 token `sub`에서만 추출. tool args 안에 userId 박아도 무시되도록 본 lib이 보장하지만, 호출자가 검증을 책임진다.
- **Scope enforce는 transport 단에서만**: `auth.scopes`는 MCP server transport가 사용 — lib import 경로엔 enforce 효과 없음. openAPI 호출 시 항상 `read:calendar` + `write:calendar` 둘 다 박혀 나감. 호환을 위한 형식 필드.
- **환경변수 4개 셋업** (lib 프로세스에 주입):
  - `OPENAPI_BASE_URL` — openAPI base URL
  - `OPENAPI_PAT_MCP` — 서비스 인증 PAT (`mcp_<secret>` 형식)
  - `SIGNING_SECRET` — `x-open-user-token` HS256 서명 키 (openAPI와 공유)
  - `CONFIRM_SECRET` — confirm token HMAC 키

### 응답 / 에러 면

- **Raw passthrough**: 응답 페이로드는 openAPI 그대로. `outputSchema`는 LLM 설명 채널 — runtime parse 안 함. 추가 필드도 보존.
- **에러**: `ToolError` 형태 — `{ status, code, message }`. `code` 카탈로그: `InvalidParameter`(400) / `NotFound`(404) / `InsufficientScope`(403) / `Timeout`(0) 등. `message`는 자연어 보강, `code`·`status`는 항상 원본.

### Export 면

`todocalendar-tools/tools`만 공개. 시그니처·타입 변경은 semver major.

---

## License

MIT.
