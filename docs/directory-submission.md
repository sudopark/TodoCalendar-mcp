# Claude Connectors 디렉토리 제출 자료 (#72)

포털 10단계에 그대로 옮겨 적는 답안지. 제출은 사용자 계정에서 사용자가 한다.

> **이 레포는 public이다.** 테스트 계정 자격증명을 여기 적지 말 것 — 포털 폼에만 입력한다.

## 1. Connection

| 항목 | 값 |
| --- | --- |
| Server URL | `https://mcp.todo-calendar.com/mcp` |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1 (DCR + PKCE S256). AS는 Functions 레포가 운영 |

## 2. Tools

30개. `tools/list`가 각 tool의 `title` / `readOnlyHint` / `destructiveHint`를 함께 싣는다.

- 조회 9종 (`readOnlyHint: true`) — `get_todos` `get_expanded_todos` `get_schedules` `get_expanded_schedules` `get_done_todos` `get_tags` `get_event_details` `get_foremost_event` `describe_tool`
- 파괴적 10종 (`destructiveHint: true`) — `delete_todo` `delete_schedule` `delete_done_todo` `delete_tag` `delete_event_detail` `exclude_schedule_occurrence` `replace_todo` `replace_schedule_occurrence` `branch_schedule_repeating` `clear_foremost_event`
- 나머지 11종은 비파괴 write (`destructiveHint: false` 명시)

`delete_todo` / `delete_schedule`은 2-step CONFIRM이다. 첫 호출은 변이 없이 `{ status: 'confirm_required', confirmToken }`을 돌려주고, 같은 인자 + 토큰으로 재호출해야 실행된다 (토큰 5분, 유저·tool·인자에 바인딩).

## 3. Listing

| 필드 | 값 | 제한 |
| --- | --- | --- |
| Name | To-do Calendar | ≤100자 |
| One-liner | Read and manage your to-dos, schedules, tags and reminders in To-do Calendar — straight from the chat. | ≤200자 |
| Categories | Productivity / Calendar / Task management 계열에서 1–5개 (포털이 제시하는 목록이 정본) | 1–5개 |
| Documentation URL | `https://github.com/sudopark/TodoCalendar-mcp#connect-from-claude` — 11/20 제출은 README로 간다 (PM 결정 2026-11-13) | |
| Privacy policy URL | `https://todo-calendar.com/privacy/en` | |
| Support contact | todocalendar.help@gmail.com | |
| Icon | `todo-calendar.com/logo-light.png` (1024×1024 PNG) | |
| URL slug | `todo-calendar` — **공개 후 변경 불가** | |

### Description (≤2000자)

```
To-do Calendar is a calendar and to-do app for iOS and the web. This connector lets an AI
assistant work with the same data the app shows you: to-dos, schedules, tags, event details
and your pinned event.

What you can do in chat:
- Ask what is on your calendar today, this week, or on any date. Repeating events are expanded
  server-side, so you get the actual dates each occurrence falls on — including weekday
  accrual, month-end skips, leap years and lunar rules.
- Add, edit and reschedule to-dos and schedules, including repeating ones.
- Complete a to-do, revert a completed one, or review what you finished.
- Organise with tags, attach places, links and memos to an event, and pin the one event you
  want kept in front of you.
- Edit a single occurrence of a repeating event, skip one occurrence, or split a series from a
  given date onward, without touching the rest of the series.

How your data is handled:
- You connect with your own To-do Calendar account over OAuth 2.1. The connector only ever
  acts on the account that approved the connection — the user identity comes from the verified
  access token, never from a tool argument.
- Two scopes are requested and shown on the consent screen: read:calendar and write:calendar.
- Deleting a to-do or a schedule takes two steps. The first call changes nothing and returns a
  confirmation token with a human-readable message; the assistant has to come back with that
  token for the deletion to happen. Tokens expire in 5 minutes.
- You can end the connection at any time from the Claude connector settings, which drops the
  tokens Claude holds. Access tokens are short-lived (2 hours) and the refresh token can be
  revoked at the authorization server.

The connector is a thin adapter in front of the To-do Calendar API, operated by the same
developer as the app. There is no third-party service behind it.
```

## 4. Use cases

Read **and** write. 대표 프롬프트는 §7 리뷰어 안내의 목록을 쓴다.

## 5. Company

개인 개발자(박현수). 앱: [To-do Calendar](https://apps.apple.com/kr/app/to-do-calendar/id6639620385).

## 6. Authentication / Data handling

| 질문 | 답 |
| --- | --- |
| 뒤에 있는 API를 직접 소유·운영하나 | 예. 앱과 같은 개발자가 운영하는 To-do Calendar API |
| 서드파티 API를 중계하나 | 아니오 |
| 개인 건강정보를 다루나 | 아니오 |
| 스폰서·광고 콘텐츠를 응답에 섞나 | 아니오 |
| 인증 방식 | OAuth 2.1 — DCR(RFC 7591), PKCE S256, `resource`→token `aud` 바인딩 |

## 7. Test & launch — 리뷰어 안내

자격증명은 포털 폼에만 넣는다. 아래 절차를 그대로 적는다.

1. Claude에서 **Settings → Connectors → Add custom connector**를 열고 URL에 `https://mcp.todo-calendar.com/mcp`를 넣는다.
2. 연결을 누르면 To-do Calendar 로그인 화면이 뜬다. 제출 폼에 적은 테스트 계정으로 로그인한다. 동의 화면에 `read:calendar`·`write:calendar`가 표시되는 것을 확인한다.
3. 연결 후 아래를 순서대로 시도하면 조회 → 생성 → 수정 → 삭제 전 경로를 덮는다.
   - "What's on my calendar this week?" → `get_expanded_schedules`
   - "What to-dos do I have open?" → `get_todos`
   - "Add a to-do: buy coffee beans, tomorrow 9am" → `create_todo`
   - "Move it to 10am" → `update_todo`
   - "Mark it done" → `complete_todo`
   - "Show my tags" → `get_tags`
   - "Add a weekly team meeting, Mondays 10am" → `create_schedule`
   - "Skip next Monday's team meeting" → `exclude_schedule_occurrence`
   - "Delete the team meeting" → `delete_schedule` — **첫 호출은 확인 요청만 돌려준다.** 승인하면 두 번째 호출로 실제 삭제된다
4. 테스트 계정에는 반복 일정과 완료된 할일이 미리 들어 있어야 한다. 비어 있으면 조회 tool이 빈 배열을 돌려주고 리뷰어가 동작을 확인하지 못한다.

## 8. 공식 MCP 레지스트리 (심사 없음, 병행)

[`server.json`](../server.json)이 레포 루트에 있다. 라이브 스키마(`2025-12-11`) 기준 필수 필드는 `name`·`description`(≤100자)·`version`이고, remote 전용 서버는 `packages` 없이 `remotes`만 둔다.

```bash
brew install mcp-publisher
mcp-publisher validate
mcp-publisher login github
mcp-publisher publish
```

`login github`은 device OAuth다. 현재 `server.json`의 이름은 `io.github.sudopark/todocalendar` — 개인 GitHub 네임스페이스라 추가 인프라가 필요 없다.

도메인 네임스페이스(`com.todo-calendar/todo-calendar`)로 가려면 apex TXT 레코드와 키쌍이 필요하다.

```
todo-calendar.com. IN TXT "v=MCPv1; k=ed25519; p=<base64 공개키>"
```

레지스트리 이름은 공개 후 바꿀 수 없다. 둘 중 하나를 publish 전에 확정해야 한다.

## 남은 결정

- **레지스트리 네임스페이스** — `io.github.sudopark/...`(현재 값, 즉시 가능) vs `com.todo-calendar/...`(DNS TXT 필요). 영구. **확정 전 publish 금지.**
- **테스트 계정** — 사용자가 계정을 만들면 tool로 반복 일정·완료 할일을 채운다. 자격증명은 포털 폼에만 입력.

Documentation URL은 정해졌다 — 11/20 제출은 README `#connect-from-claude` 로 간다. `todo-calendar.com` 안내 페이지(직접 설치 버튼 포함)는 출시 전 따로 만들고 승인 뒤 리스팅 URL을 갈아끼운다.
