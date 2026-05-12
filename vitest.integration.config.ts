import { defineConfig } from 'vitest/config'

// Integration test config. Unit과 분리 — emulator 의존이라 로컬 수동 기동 전제.
// `npm run test:integration`으로 별도 실행. 누락된 env / emulator 미기동은 setup에서
// 통째 skip되므로 CI 친화적 (필요 시 .env.integration 안 깔고 실행하면 skip).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // 여러 통합 테스트 파일이 동시에 emulator를 두드리면 firestore write 부하·flakiness
    // 가능 + 실패 시 어느 파일이 원인인지 추적 어려움. 파일 단위 직렬로 단순화
    // (it 간 격리는 unique userId가 별도 보장 — pool/fileParallelism은 user 격리와 무관).
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
