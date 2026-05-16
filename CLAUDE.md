# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

24개 tool 구현 + unit/integration 테스트 + OAuth Resource Server까지 도달. 첫 외부 publish/배포 전. 전체 사양은 [issue #1](https://github.com/sudopark/TodoCalendar-mcp/issues/1)이 source of truth이며, 구현 결정이 충돌하면 issue를 우선한다.

## What this is

AI Agent가 TodoCalendar의 todo / schedule / tag 데이터를 다룰 수 있도록 노출. 자체 비즈니스 로직 없음 — userId 강제·CONFIRM·AI 친화 변환 후 sibling 레포 `sudopark/TodoCalendar-Functions`의 openAPI를 호출하는 얇은 어댑터.

두 종류의 호출자:

- **외부 AI Agent** (Claude Desktop 등): MCP server를 Streamable HTTP로 호출. OAuth 2.1 Resource Server (`AUTH_MODE=oauth`) — Bearer RS256 JWT 검증. 로컬 dev는 `AUTH_MODE=dev` + `X-Dev-User-Id` 헤더 stub.
- **first-party** (`aiFrontAPI` 서버사이드 AI 호스트): tool 함수를 npm 라이브러리로 직접 import — MCP transport 우회.

## Architecture

```mermaid
flowchart TB
    ExtUser["모바일/웹 앱 사용자"]
    ExtAgent["외부 AI Agent (Claude Desktop 등)"]
    AiFront["aiFrontAPI<br/>(Functions repo)<br/>Firebase Auth + Anthropic 루프"]
    OpenAPI["openAPI /v2/open/*<br/>(Functions repo)"]
    Lib["todocalendar-tools<br/>(npm via GitHub Packages)<br/>tools/ = export 면"]
    MCPServer["MCP server<br/>(Cloud Run, this repo)"]
    Anthropic["Anthropic API"]

    ExtUser -->|chat req| AiFront
    AiFront <-->|tool_use 루프| Anthropic
    AiFront -->|"npm install + import 'tools'"| Lib

    ExtAgent -->|"Streamable HTTP + Bearer (OAuth RS)"| MCPServer
    MCPServer -.->|local source 동일 코드| Lib

    Lib -->|"HTTP — PAT + 자체 서명 HS256 JWT"| OpenAPI
```

같은 `tools/` 코드가 두 진입점(외부 AI Agent → MCP server transport, first-party → aiFrontAPI lib import)에서 공유. 둘 다 결국 openAPI를 호출.

## Stack

- Node.js 24+, TypeScript
- MCP SDK: `@modelcontextprotocol/sdk`
- Transport: Streamable HTTP
- 호스팅: **Cloud Run** (수동 배포 — CI/CD 자동화 없음, [#12](https://github.com/sudopark/TodoCalendar-mcp/issues/12) deprecated)
- JWT: `jsonwebtoken` (**Firebase Admin SDK 의존 금지** — 아래 §2)
- Test: vitest (unit + integration. integration은 Functions emulator 전제)

## Two artifacts in this repo

| 산출물                                 | 배포처          | 소비자                              |
| -------------------------------------- | --------------- | ----------------------------------- |
| **MCP server**                         | Cloud Run       | 외부 AI Agent (OAuth RS)            |
| **npm library** (`todocalendar-tools`) | GitHub Packages | `TodoCalendar-Functions/aiFrontAPI` |

운영: 단일 버전, 단일 릴리스. **CI/CD 자동화 없음 — `npm publish` + `gcloud run deploy` 둘 다 작업자가 수동.** integration test도 CI에 안 붙임 — PR 머지 전 작업자가 로컬 emulator 위에서 직접 `npm run test:integration` 실행. 자세한 명령은 [`CONTRIBUTING.md`](./CONTRIBUTING.md).

`package.json` `exports`가 외부 공개 면 — **`tools/`만** 노출. `server.ts`, `openapi/`, `confirm/`, `auth/`, `middleware/` 등 나머지는 전부 비공개. openapi 클라이언트나 confirm 토큰 모듈은 tool 안에서만 쓰이고, 직접 노출하면 다운스트림이 tool 레이어를 우회할 위험.

서버는 자기 코드를 로컬 import (`./tools/...`)로 쓴다 — published lib을 자기가 install하지 않는다.

## Commands

`npm run dev` / `build` / `start` / `test` / `test:integration` / `typecheck` / `lint` / `format:check`. 자동수정(`prettier --write` / `eslint --fix`)은 사용자 명시 승인 후에만 — silent format 금지. 전체 표는 [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Architectural constraints (non-obvious — 반드시 준수)

이 결정들은 보안·레포 분리·다운스트림 호환과 직결되므로 임의로 바꾸지 말 것. 변경이 필요하면 issue에서 먼저 합의.

### 1. JWT 검증 시 algorithm·issuer·audience 화이트리스트 명시

`algorithms: ['RS256']` + `issuer: env MCP_OAUTH_ISSUER` + `audience: env MCP_CANONICAL_URI`. 알고리즘 confusion attack 차단. issuer/audience는 env에서 단일값 화이트리스트로 주입 — Functions repo AS issuer / 본 server canonical URI와 정확히 일치해야 검증 통과. 본 server는 키쌍을 직접 보유하지 않음 — `<issuer>/.well-known/jwks.json`에서 public key를 fetch.

### 2. Firebase Admin SDK 도입 금지

Firebase Auth 검증은 aiFrontAPI가 흡수한다. MCP는 Firebase를 직접 검증하지 않음. 의존성 다시 끌어오면 레포 분리 전제가 깨진다.

### 3. userId는 항상 검증된 토큰의 `sub`에서만 추출

Tool 인자(`request.params.arguments`)로 userId 받지 말 것 — Claude가 임의 변조 가능. `auth.userId`만 사용. lib 직접 호출 경로(aiFrontAPI)에서도 동일 — 호출자가 `auth` context를 만들어 넘기고 args 안 userId는 무시.

### 4. openAPI 호출 시 헤더 두 개 항상 동시

- `Authorization: Bearer mcp_<secret>` (서비스 인증, env `OPENAPI_PAT_MCP`. 형식 `<service>_<secret>`, MVP 화이트리스트는 `mcp` 한 종류)
- `x-open-user-token: <userJwt>` — `SIGNING_SECRET`으로 HS256 자체 서명. payload `{ sub: auth.userId, scope: ['read:calendar', 'write:calendar'] }`

scope claim 빠지면 openAPI가 403 `InsufficientScope` 반환. forward 개념 없음 — 호출자(MCP server / aiFrontAPI lib)가 항상 자기가 서명.

### 5. 삭제·대량 수정은 CONFIRM 강제

즉시 실행 X — 첫 호출에 `confirmToken` (HMAC, 5분 TTL) 발급, 클라가 confirmToken으로 재호출하면 실행. 대상: `delete_todo`, `delete_schedule` (issue #1 §2.4). lib 직접 호출 경로에도 동일 적용.

### 6. Tool 응답: openAPI raw 통과 + schema description으로 LLM 보조

응답 페이로드는 **openAPI raw 그대로 노출** — timestamp(Unix sec) 변환·필드 rename·필드 드롭 모두 안 함. round-trip(read → modify → write)·소비자 캐시·감사로그가 무손실로 동작해야 하므로 (`userId` 같은 redundant 필드도 보존 — 클라 파싱 영향 추적 비용 > 보존 비용).

`outputSchema`는 **문서화 채널 전용**이다. `tool.execute`는 `outputSchema.parse(result)`를 호출하면 안 됨 — 런타임 검증을 끼우는 순간 unknown 필드를 drop하거나 type coerce가 일어나서 raw passthrough 약속이 깨진다. zod로 정의된 모양은 MCP가 LLM에 노출하는 description 채널일 뿐, 실제 페이로드는 fetch가 돌려준 객체를 그대로 cast해서 통과시킨다.

LLM이 raw를 해석하도록 돕는 채널은 **MCP가 LLM에 보내는 schema description뿐**:

- tool `description`: 응답 모양·timestamp 단위(Unix epoch seconds, UTC)·discriminator 규칙(예: `event_time.time_type`, `repeating.option.optionType`)
- `inputSchema` / `outputSchema` 각 필드 `.describe()`: 단위·의미·optional 의도

예외는 **에러**: `InvalidParameter` / `NotFound` / `InsufficientScope` 등 코드는 자연어 메시지로 보강. 단 `code`·`status`는 `ToolError`에 그대로 보존 — 호출자가 분기·재시도·로그 분류에 쓰므로 자연어 메시지는 *추가*되는 면이지 대체되는 면이 아니다. 에러는 round-trip 대상 아니므로 보강해도 무손실 깨지지 않음.

### 7. Library export 면을 좁게 유지, breaking은 major 버전

`exports`에 노출된 모듈은 `aiFrontAPI`가 핀하므로 함부로 깨면 다운스트림이 부러진다. 시그니처 / 타입 / 반환 구조 변경은 semver major. 서버 내부는 export 안 하므로 자유롭게 변경.

## Layer flow

```
[외부 AI Agent — MCP transport]
  → MCP server: Streamable HTTP 수신
  → AUTH_MODE 분기: oauth(Bearer RS256 검증) / dev(X-Dev-User-Id stub) → { userId, scopes } 반환
  → tools[name].execute(auth, args)        // userId는 auth에서만, args 무시
  → openapi/client.callOpenApi(auth, ...)  // PAT + 자체 서명 HS256 JWT 주입

[first-party — npm library import, MCP 우회]
  aiFrontAPI 안에서:
  → Firebase Auth 검증 → userId 획득
  → import { tools, type Auth } from '@sudopark/todocalendar-tools/tools'
  → 같은 tools[name].execute(auth, args) 직접 호출  // auth = { userId, scopes }
  → openapi/client.callOpenApi(...)
```

`tools[name].execute(auth, args)` 시그니처·동작이 두 경로에서 동일. transport만 다름.

## Environment variables

필수:

- `OPENAPI_BASE_URL` — openAPI 호출 base
- `OPENAPI_PAT_MCP` — openAPI 서비스 인증 PAT (`mcp_<secret>` 형식)
- `SIGNING_SECRET` — `x-open-user-token` HS256 서명 키 (aiFrontAPI / openAPI와 공유)
- `CONFIRM_SECRET` — confirm token HMAC 키 (본 레포 내부)

OAuth 모드 (`AUTH_MODE=oauth`):

- `MCP_OAUTH_ISSUER` — AS root URL (token iss 화이트리스트 + JWKS base)
- `MCP_CANONICAL_URI` — 본 server canonical URI (token aud 검증 + RFC 9728 resource). Functions 측과 동일 값. 운영: `https://mcp.todo-calendar.com/mcp`

옵션:

- `AUTH_MODE` — `oauth` (기본) / `dev`
- `OPENAPI_TIMEOUT_MS` / `OPENAPI_RETRY_COUNT` — client retry tuning
- `ALLOWED_HOSTS` — DNS rebinding 방어, Cloud Run 호스트명 콤마 구분. 운영 권장
- `PORT` — HTTP listen 포트, 기본 3000

전체 설명·로컬 dev 절차는 `.env.example` + [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Cross-repo dependencies

이 레포 단독으로는 동작 불가 — integration은 Functions 레포 emulator 위에서.

- `sudopark/TodoCalendar-Functions#151` — AI 기능 전체 설계 (parent)
- `sudopark/TodoCalendar-Functions#152` — openAPI MVP (호출 대상)
- `sudopark/TodoCalendar-Functions#189` — OAuth Authorization Server (token iss, 본 server가 검증)
- `sudopark/TodoCalendar-Functions` `aiFrontAPI` — lib 소비자

openAPI 스펙 source of truth: `TodoCalendar-Functions/functions/swagger/swagger.yaml` (`/v2/open/*` 경로 + components.schemas 모델 + 에러 모델 `{status, code, message}`. 코드 카탈로그: `InvalidParameter`(400) / `NotFound`(404) / `InsufficientScope`(403) / `Timeout`(0, 본 레포 client retry 도입 시 추가))
