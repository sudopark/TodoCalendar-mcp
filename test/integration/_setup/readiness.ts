import { envReadyOrSkipReason } from './env.js'
import { emulatorReadyOrSkipReason } from './emulator.js'

// 통합 테스트 파일 top-level await로 한 번 호출 → describe.skipIf(!ready)에 결과 주입.
// env 누락 / emulator 미기동 시 명확한 이유를 console.warn으로 1회 출력.
export interface Readiness {
  ready: boolean
  reason?: string
}

export const checkReadiness = async (): Promise<Readiness> => {
  const envReason = envReadyOrSkipReason()
  if (envReason !== undefined) return { ready: false, reason: envReason }
  const emReason = await emulatorReadyOrSkipReason(process.env.OPENAPI_BASE_URL ?? '')
  if (emReason !== undefined) return { ready: false, reason: emReason }
  return { ready: true }
}

export const warnIfSkipping = (label: string, r: Readiness): void => {
  if (!r.ready && r.reason !== undefined) {
    console.warn(`[integration:${label}] skipped — ${r.reason}`)
  }
}
