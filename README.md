# TodoCalendar-mcp

MCP server + npm tool library for the TodoCalendar AI integration. 자세한 아키텍처·제약은 [`CLAUDE.md`](./CLAUDE.md)와 [issue #1](https://github.com/sudopark/TodoCalendar-mcp/issues/1) 참고.

## Test

### Unit

```sh
npm test
```

`test/integration/**`은 제외됨.

### Integration (Functions emulator)

실제 openAPI(Functions emulator)에 붙어 round-trip을 검증한다. emulator 미기동·env 누락 시 통합 테스트는 통째로 skip된다 — 실수로 실 서버를 때리지 않기 위함.

**1. Functions emulator 기동**

```sh
cd ../TodoCalendar-Functions
firebase emulators:start
```

emulator 포트(기본 5001) + project-id 확인. 자세한 절차는 Functions 레포 README 참고.

**2. `.env.integration` 생성**

```sh
cp .env.integration.example .env.integration
# OPENAPI_BASE_URL의 <project-id>를 Functions emulator project-id로 치환
# OPENAPI_PAT_MCP / SIGNING_SECRET은 Functions repo의 functions/secrets/.env와 동일 값
# CONFIRM_SECRET은 MCP 내부용 — 아무 random 문자열
```

`.env.integration` 파일은 gitignore됨 — 실 secret이 커밋되지 않도록 주의.

**3. 실행**

```sh
npm run test:integration
```

`.env.integration` 누락 또는 emulator 미기동 시 명확한 skip 사유가 출력된다.

#### 커버 범위

- **happy path** — 각 tool 1개 (24개)
- **CONFIRM 2단계** — `delete_todo` / `delete_schedule` 토큰 발급 → 실 삭제 검증
- **scope 가드** — `write:calendar` 누락 토큰으로 POST 호출 시 openAPI가 403 InsufficientScope를 반환하는지 1발 확인

에러 분기 폭주(`InvalidParameter` / `NotFound` 등) 회귀는 unit test가 mock으로 이미 가드 (`test/tools/**`).
