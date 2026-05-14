# Contributing

본 레포에서 작업하는 사람을 위한 문서. 외부 소비자용 진입 가이드는 [`README.md`](./README.md), 아키텍처 제약과 변경 시 합의 규칙은 [`CLAUDE.md`](./CLAUDE.md), 전체 사양 source of truth는 [issue #1](https://github.com/sudopark/TodoCalendar-mcp/issues/1).

---

## Local development

본 레포 단독으로는 동작 불가 — openAPI([`TodoCalendar-Functions`](https://github.com/sudopark/TodoCalendar-Functions)) emulator가 있어야 함.

### 1. Functions emulator 기동

```sh
cd ../TodoCalendar-Functions
firebase emulators:start
```

기본 포트: functions 5001 / firestore 8080 / auth 9099.

### 2. `.env` 셋업

```sh
cp .env.example .env
```

수정 포인트:

- `MCP_CANONICAL_URI` default는 production 값 → 로컬에서는 `http://localhost:3000/mcp`로 override
- `OPENAPI_PAT_MCP` / `SIGNING_SECRET`은 Functions repo의 `functions/secrets/.env.test`에서 가져옴 (emulator는 prod `secrets/.env`가 아닌 `.env.test`의 dummy hex를 주입). PAT는 `mcp_` prefix 붙여서.
- `AUTH_MODE=dev`로 두면 `X-Dev-User-Id` 헤더 stub 사용 가능 (mcp-inspector 등)

### 3. MCP server 띄우기

```sh
npm install
npm run dev      # tsx watch
# 또는
npm run build && npm start
```

`http://localhost:3000/mcp`에 Streamable HTTP listener 뜸.

---

## Environment variables

| 변수                  | 필수      | 비고                                                                                             |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `OPENAPI_BASE_URL`    | ✅        | openAPI 호출 base URL                                                                            |
| `OPENAPI_PAT_MCP`     | ✅        | openAPI 서비스 인증 PAT (`mcp_<secret>` 형식)                                                    |
| `SIGNING_SECRET`      | ✅        | `x-open-user-token` HS256 서명 키 — Functions repo와 공유                                        |
| `CONFIRM_SECRET`      | ✅        | confirm token HMAC 키 (본 레포 내부)                                                             |
| `AUTH_MODE`           | —         | `oauth` (기본, 외부 노출) / `dev` (X-Dev-User-Id stub)                                           |
| `MCP_OAUTH_ISSUER`    | oauth 시  | AS root URL — token iss 화이트리스트 + JWKS base                                                 |
| `MCP_CANONICAL_URI`   | oauth 시  | 본 server canonical URI — token aud 검증 + RFC 9728 resource. Functions side와 동일 값이어야 함. |
| `OPENAPI_TIMEOUT_MS`  | —         | 단일 fetch 타임아웃, 기본 10000                                                                  |
| `OPENAPI_RETRY_COUNT` | —         | 멱등 메소드 재시도 횟수, 기본 2                                                                  |
| `ALLOWED_HOSTS`       | 운영 권장 | DNS rebinding 방어 — Cloud Run 호스트명 콤마 구분                                                |
| `PORT`                | —         | HTTP listen 포트, 기본 3000                                                                      |

전체 설명은 [`.env.example`](./.env.example).

---

## Test

### Unit

```sh
npm test
```

`test/integration/**`는 제외.

### Integration (Functions emulator)

```sh
cp .env.integration.example .env.integration
# 위 1번과 동일하게 emulator 기동, secret은 Functions의 .env.test에서
npm run test:integration
```

emulator 미기동·env 누락 시 통째 skip — 실수로 실 서버 hit 차단.

#### 커버 범위

- 24 tool happy path (1 skip — `branch_schedule_repeating`은 upstream [Functions#178](https://github.com/sudopark/TodoCalendar-Functions/issues/178) 머지 대기)
- `delete_todo` / `delete_schedule` CONFIRM 2단계
- openAPI scope 가드 1발 — tool layer 우회하고 직접 fetch로 호출, 403 InsufficientScope 반환 확인 (openAPI 측 enforcement 회귀 가드)

에러 분기 회귀(`InvalidParameter` / `NotFound` 등)는 unit이 mock으로 가드 (`test/tools/**`).

> CI에 안 붙임. PR 머지 전 작업자가 로컬에서 직접 실행.

---

## Deploy

CI/CD 자동화 없음. 작업자가 `git tag vX.Y.Z` 단위로 수동.

### npm publish (lib)

```sh
npm version <patch|minor|major>
npm run build
npm publish  # GitHub Packages
```

### Cloud Run (MCP server)

```sh
# ALLOWED_HOSTS 값에 콤마가 들어가므로 custom delimiter(^@^) 사용 — 기본 콤마 delimiter로
# 박으면 잘려서 두 번째 host가 다른 env 항목으로 오인됨.
gcloud run deploy todocalendar-mcp \
  --source . \
  --region <region> \
  --set-env-vars="^@^OPENAPI_BASE_URL=...@AUTH_MODE=oauth@MCP_OAUTH_ISSUER=...@MCP_CANONICAL_URI=https://mcp.todo-calendar.com/mcp@ALLOWED_HOSTS=host1.run.app,host2.run.app" \
  --set-secrets="OPENAPI_PAT_MCP=openapi-pat-mcp:latest,SIGNING_SECRET=signing-secret:latest,CONFIRM_SECRET=confirm-secret:latest"
```

Secret은 [GCP Secret Manager](https://cloud.google.com/secret-manager)에 사전 등록. `mcp.todo-calendar.com` custom domain은 Cloud Run domain mapping + DNS A/AAAA 레코드 1회 셋업.

본 MCP는 OAuth Resource Server라 자체 키쌍을 보유하지 않음 — JWKS는 issuer에서 fetch.

---

## Commands 요약

| script                                    | 동작                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                             | `tsx watch src/server.ts` — 로컬 MCP server (port 3000)                              |
| `npm run build`                           | `tsc -p tsconfig.build.json` → `dist/`                                               |
| `npm start`                               | `node dist/server.js` (build 결과 실행)                                              |
| `npm test`                                | vitest unit (`test/integration/**` 제외)                                             |
| `npm run test:watch`                      | vitest unit watch                                                                    |
| `npm run test:integration`                | vitest integration — Functions emulator + `.env.integration` 전제, 누락 시 통째 skip |
| `npm run typecheck`                       | `tsc --noEmit`                                                                       |
| `npm run lint` / `npm run lint:fix`       | eslint                                                                               |
| `npm run format:check` / `npm run format` | prettier (자동수정은 사용자 명시 승인 후에만 — silent format 금지)                   |

---

## Cross-repo dependencies

- [`TodoCalendar-Functions#151`](https://github.com/sudopark/TodoCalendar-Functions/issues/151) — AI 기능 전체 설계 (parent)
- [`TodoCalendar-Functions#152`](https://github.com/sudopark/TodoCalendar-Functions/issues/152) — openAPI MVP (호출 대상)
- [`TodoCalendar-Functions#189`](https://github.com/sudopark/TodoCalendar-Functions/issues/189) — OAuth Authorization Server
- [`TodoCalendar-Functions#178`](https://github.com/sudopark/TodoCalendar-Functions/issues/178) — `branch_schedule_repeating` 500 (fix 후 본 레포 `it.skip` 제거)
- [`TodoCalendar-Functions#191`](https://github.com/sudopark/TodoCalendar-Functions/issues/191) — `revertDoneTodoV2` 응답 `todo.name` 누락 (fix 후 본 레포 회귀 가드 복원)
- `TodoCalendar-Functions/aiFrontAPI` — lib 소비자

openAPI 스펙 source of truth: `TodoCalendar-Functions/functions/swagger/swagger.yaml`.
