import { defineConfig } from 'vitest/config'

// Integration test config. Unit과 분리 — emulator 의존이라 로컬 수동 기동 전제.
// `npm run test:integration`으로 별도 실행. 누락된 env / emulator 미기동은 setup에서
// 통째 skip되므로 CI 친화적 (필요 시 .env.integration 안 깔고 실행하면 skip).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Firestore에 순차로 쓰는 시나리오(CONFIRM 2단계 등)가 있어 동시 실행은 피한다.
    // 격리는 unique userId로 해결하지만 동일 user 내 이벤트 순서는 보장 필요.
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
