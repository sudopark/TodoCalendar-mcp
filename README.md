# TodoCalendar-mcp

AI agent가 TodoCalendar의 todo / schedule / tag 데이터를 다룰 수 있게 노출하는 MCP server + npm tool library.

두 진입점, 같은 tool layer:

- **MCP server** (Streamable HTTP) — 외부 AI Agent용 (Claude Desktop 등)
- **`todocalendar-tools`** (npmjs.com, public) — first-party AI 호스트가 직접 import해서 사용

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

본 server는 `GET /.well-known/oauth-protected-resource` (RFC 9728)로 AS 위치·scope 목록 공개.

### Tools

29개. 응답은 openAPI raw passthrough — timestamp 단위 변환 없음, 필드 rename 없음.

기간 조회 시 반복 이벤트의 실제 발생일이 필요하면 `get_expanded_*` (서버가 occurrence 단위로 전개, Functions #244), 원본 규칙 메타만 필요하면 기존 `get_todos`/`get_schedules`를 쓴다.

| 도메인             | tools                                                                                                                                                                                            | CONFIRM           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **todo**           | `get_todos` / `get_expanded_todos` / `create_todo` / `update_todo` / `complete_todo` / `replace_todo` / `delete_todo`                                                                            | `delete_todo`     |
| **schedule**       | `get_schedules` / `get_expanded_schedules` / `create_schedule` / `update_schedule` / `exclude_schedule_occurrence` / `replace_schedule_occurrence` / `branch_schedule_repeating` / `delete_schedule` | `delete_schedule` |
| **tag**            | `get_tags` / `create_tag` / `update_tag` / `delete_tag`                                                                                                                   | —                 |
| **done todo**      | `get_done_todos` / `update_done_todo` / `revert_done_todo` / `delete_done_todo`                                                                                           | —                 |
| **event detail**   | `get_event_details` / `set_event_detail` / `delete_event_detail`                                                                                                          | —                 |
| **foremost event** | `get_foremost_event` / `set_foremost_event` / `clear_foremost_event`                                                                                                      | —                 |

상세 입출력 스키마는 `tools/list` 응답 또는 각 tool의 `description` / `inputSchema` 참고.

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
