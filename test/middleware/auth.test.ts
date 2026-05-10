import type { IncomingHttpHeaders } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  AuthRequiredError,
  DEV_USER_ID_HEADER,
  extractDevAuth,
} from '../../src/middleware/auth.js'

describe('extractDevAuth', () => {
  it('헤더에 userId 있으면 Auth 반환', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: 'u-1' }

    expect(extractDevAuth(headers)).toEqual({ userId: 'u-1' })
  })

  it('헤더 누락 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = {}

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 빈 문자열 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '' }

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 공백만 — AuthRequiredError', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '   ' }

    expect(() => extractDevAuth(headers)).toThrow(AuthRequiredError)
  })

  it('헤더 값 trim — 앞뒤 공백 제거', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: '  u-2  ' }

    expect(extractDevAuth(headers)).toEqual({ userId: 'u-2' })
  })

  it('헤더 값 배열 — 첫 번째 사용 (Node이 동일 헤더 여러 번 받았을 때)', () => {
    const headers: IncomingHttpHeaders = { [DEV_USER_ID_HEADER]: ['u-3', 'u-4'] }

    expect(extractDevAuth(headers)).toEqual({ userId: 'u-3' })
  })
})
