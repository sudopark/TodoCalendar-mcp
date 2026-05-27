import { describe, expect, it } from 'vitest'
import { hashUserId } from '../../src/internal/hashUserId.js'

describe('hashUserId', () => {
  it('sha256 hex 64자 반환', () => {
    const h = hashUserId('firebase-uid-abcdef1234567890')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('같은 input → 같은 hash (결정성)', () => {
    const a = hashUserId('user-123')
    const b = hashUserId('user-123')
    expect(a).toBe(b)
  })

  it('다른 input → 다른 hash', () => {
    expect(hashUserId('user-a')).not.toBe(hashUserId('user-b'))
  })

  it('16자보다 짧은 userId도 동작 (slice 안전)', () => {
    const h = hashUserId('short')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('빈 문자열 입력도 throw 없이 hash 반환 (defensive)', () => {
    const h = hashUserId('')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
