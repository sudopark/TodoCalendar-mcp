import crypto from 'node:crypto'
import type { Auth } from '../../../src/auth/types.js'

// 매 테스트마다 unique userId로 Firestore 격리. emulator는 재기동 시 휘발이라 누적 데이터 무방.
// 'integration-' prefix로 prod userId와 시각적으로 구분.
export const makeIntegrationAuth = (): Auth => ({
  userId: `integration-${crypto.randomBytes(8).toString('hex')}`,
  scopes: ['read:calendar', 'write:calendar'],
})
