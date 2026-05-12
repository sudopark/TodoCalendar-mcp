import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('scope', readiness)

// readiness 통과 후에만 사용. `?? ''`은 readiness 가드로 도달 불가지만 타입 좁히기용.
const BASE_URL = (process.env.OPENAPI_BASE_URL ?? '').replace(/\/$/, '')
const PAT = process.env.OPENAPI_PAT_MCP ?? ''
const SIGNING_SECRET = process.env.SIGNING_SECRET ?? ''

// scope 누락 토큰은 MCP 정상 경로(signUserToken)에서 만들 수 없으므로 직접 서명.
// raw fetch로 openAPI 호출 → 403 InsufficientScope 가드 검증.
// tool 단위 happy path가 이미 정상 경로를 검증하므로 scope는 1발만.
const signScopedUserToken = (userId: string, scopes: string[]): string =>
  jwt.sign({ sub: userId, scope: scopes }, SIGNING_SECRET, { algorithm: 'HS256' })

describe.skipIf(!readiness.ready)('integration: openAPI scope guard', () => {
  it('write:calendar 누락 토큰으로 POST 호출 시 403 InsufficientScope', async () => {
    const auth = makeIntegrationAuth()
    const userToken = signScopedUserToken(auth.userId, ['read:calendar'])

    const res = await fetch(`${BASE_URL}/v2/open/todos/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'x-open-user-token': userToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'should-not-create' }),
    })
    expect(res.status).toBe(403)

    const body = (await res.json().catch(() => ({}))) as { code?: string }
    expect(body.code).toBe('InsufficientScope')
  })
})
