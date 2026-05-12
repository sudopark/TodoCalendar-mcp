import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// `.env.integration`을 먼저 로드. CI 등에서 파일 없이 환경변수로 주입해도 OK.
const ENV_PATH = resolve(process.cwd(), '.env.integration')
if (existsSync(ENV_PATH)) {
  loadDotenv({ path: ENV_PATH })
}

const REQUIRED = [
  'OPENAPI_BASE_URL',
  'OPENAPI_PAT_MCP',
  'SIGNING_SECRET',
  'CONFIRM_SECRET',
] as const

// 누락된 env가 있으면 통합 테스트 전체 skip. 실행자(또는 CI)가 의도적으로 안 깐 경우를 위해
// throw 대신 skip — `.env.integration.example`을 보고 .env.integration 채우라는 안내만.
export const missingEnv = (): string[] => REQUIRED.filter((k) => !process.env[k])

export const envReadyOrSkipReason = (): string | undefined => {
  const missing = missingEnv()
  if (missing.length === 0) return undefined
  return `Integration env missing: ${missing.join(', ')}. Copy .env.integration.example to .env.integration and fill in real values.`
}
