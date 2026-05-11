import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConfirmTokenError,
  signConfirmToken,
  verifyConfirmToken,
} from '../../src/confirm/token.js'

const SECRET = 'test-confirm-secret'

beforeEach(() => {
  vi.stubEnv('CONFIRM_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('signConfirmToken / verifyConfirmToken', () => {
  it('sign → verify 양방향 — 같은 tool·args·userId면 통과', () => {
    const token = signConfirmToken('delete_todo', { id: 'todo-1' }, 'u-1')
    expect(() =>
      verifyConfirmToken(token, 'delete_todo', { id: 'todo-1' }, 'u-1'),
    ).not.toThrow()
  })

  it('payload — tool·argsHash·sub·exp 포함, HS256 서명', () => {
    const token = signConfirmToken('delete_schedule', { id: 's-1' }, 'u-42')
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload
    expect(decoded.tool).toBe('delete_schedule')
    expect(typeof decoded.argsHash).toBe('string')
    expect(decoded.sub).toBe('u-42')
    expect(decoded.exp).toBeTypeOf('number')
  })

  it('args 객체 키 순서가 달라도 동일 토큰으로 verify 가능 (canonical hash)', () => {
    const token = signConfirmToken('delete_todo', { id: 'a', force: true }, 'u-1')
    expect(() =>
      verifyConfirmToken(token, 'delete_todo', { force: true, id: 'a' }, 'u-1'),
    ).not.toThrow()
  })

  it('중첩 객체·배열도 canonical 비교', () => {
    const token = signConfirmToken(
      'delete_todo',
      {
        filter: { ids: ['a', 'b'], scope: 'all' },
        meta: { source: 'cli' },
      },
      'u-1',
    )
    expect(() =>
      verifyConfirmToken(
        token,
        'delete_todo',
        {
          meta: { source: 'cli' },
          filter: { scope: 'all', ids: ['a', 'b'] },
        },
        'u-1',
      ),
    ).not.toThrow()
  })
})

describe('verifyConfirmToken — reject', () => {
  it('6분 후 verify 실패 — Expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')

    vi.setSystemTime(new Date('2026-01-01T00:06:00Z'))
    expect(() => verifyConfirmToken(token, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Expired' }) as Partial<ConfirmTokenError>,
    )
  })

  it('5분 직전은 통과', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')

    vi.setSystemTime(new Date('2026-01-01T00:04:59Z'))
    expect(() => verifyConfirmToken(token, 'delete_todo', { id: 'a' }, 'u-1')).not.toThrow()
  })

  it('다른 tool 이름으로 verify — ToolMismatch', () => {
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')
    expect(() => verifyConfirmToken(token, 'delete_schedule', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'ToolMismatch' }) as Partial<ConfirmTokenError>,
    )
  })

  it('다른 args로 verify — ArgsMismatch', () => {
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')
    expect(() => verifyConfirmToken(token, 'delete_todo', { id: 'b' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'ArgsMismatch' }) as Partial<ConfirmTokenError>,
    )
  })

  it('다른 userId로 verify — SubMismatch (타 사용자 토큰 재사용 차단)', () => {
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')
    expect(() => verifyConfirmToken(token, 'delete_todo', { id: 'a' }, 'u-2')).toThrow(
      expect.objectContaining({ reason: 'SubMismatch' }) as Partial<ConfirmTokenError>,
    )
  })

  it('손상된 토큰 — Invalid', () => {
    expect(() => verifyConfirmToken('not-a-jwt', 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Invalid' }) as Partial<ConfirmTokenError>,
    )
  })

  it('다른 secret으로 서명한 토큰 — Invalid (signature mismatch)', () => {
    const foreign = jwt.sign(
      { tool: 'delete_todo', argsHash: 'x', sub: 'u-1' },
      'other-secret',
      { algorithm: 'HS256', expiresIn: 300 },
    )
    expect(() => verifyConfirmToken(foreign, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Invalid' }) as Partial<ConfirmTokenError>,
    )
  })

  it('algorithm none 토큰 거부 — Invalid (alg whitelist, CLAUDE.md §1)', () => {
    const noneTok = jwt.sign({ tool: 'delete_todo', argsHash: 'x', sub: 'u-1' }, '', {
      algorithm: 'none',
      expiresIn: 300,
    })
    expect(() => verifyConfirmToken(noneTok, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Invalid' }) as Partial<ConfirmTokenError>,
    )
  })

  it('문자열 payload 토큰 거부 — Invalid', () => {
    const stringTok = jwt.sign('raw-string-payload', SECRET, { algorithm: 'HS256' })
    expect(() => verifyConfirmToken(stringTok, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Invalid' }) as Partial<ConfirmTokenError>,
    )
  })

  it('sub claim 누락된 토큰 거부 — SubMismatch', () => {
    const noSubTok = jwt.sign({ tool: 'delete_todo', argsHash: 'x' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: 300,
    })
    expect(() => verifyConfirmToken(noSubTok, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'SubMismatch' }) as Partial<ConfirmTokenError>,
    )
  })

  it('argsHash claim 누락된 토큰 거부 — Invalid (포맷 깨짐, ArgsMismatch로 묻히지 않음)', () => {
    const noHashTok = jwt.sign({ tool: 'delete_todo', sub: 'u-1' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: 300,
    })
    expect(() => verifyConfirmToken(noHashTok, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'Invalid' }) as Partial<ConfirmTokenError>,
    )
  })
})

describe('canonical args hash — edge cases', () => {
  it('{a: undefined} ≡ {} — JSON 표준과 정렬', () => {
    const token = signConfirmToken('delete_todo', { a: undefined }, 'u-1')
    expect(() => verifyConfirmToken(token, 'delete_todo', {}, 'u-1')).not.toThrow()
  })

  it('{a: undefined} ≢ {a: null}', () => {
    const token = signConfirmToken('delete_todo', { a: undefined }, 'u-1')
    expect(() => verifyConfirmToken(token, 'delete_todo', { a: null }, 'u-1')).toThrow(
      expect.objectContaining({ reason: 'ArgsMismatch' }) as Partial<ConfirmTokenError>,
    )
  })

  it('Date — 같은 시각이면 같은 hash', () => {
    const t = '2026-05-10T12:34:56.000Z'
    const token = signConfirmToken('delete_schedule', { at: new Date(t) }, 'u-1')
    expect(() =>
      verifyConfirmToken(token, 'delete_schedule', { at: new Date(t) }, 'u-1'),
    ).not.toThrow()
  })

  it('Date — 다른 시각이면 다른 hash', () => {
    const token = signConfirmToken(
      'delete_schedule',
      { at: new Date('2026-05-10T12:34:56Z') },
      'u-1',
    )
    expect(() =>
      verifyConfirmToken(
        token,
        'delete_schedule',
        { at: new Date('2026-05-10T12:34:57Z') },
        'u-1',
      ),
    ).toThrow(expect.objectContaining({ reason: 'ArgsMismatch' }) as Partial<ConfirmTokenError>)
  })
})

describe('CONFIRM_SECRET env', () => {
  it('sign — secret 누락 시 throw', () => {
    vi.stubEnv('CONFIRM_SECRET', '')
    expect(() => signConfirmToken('delete_todo', { id: 'a' }, 'u-1')).toThrow(/CONFIRM_SECRET/)
  })

  it('verify — secret 누락 시 throw', () => {
    const token = signConfirmToken('delete_todo', { id: 'a' }, 'u-1')
    vi.stubEnv('CONFIRM_SECRET', '')
    expect(() => verifyConfirmToken(token, 'delete_todo', { id: 'a' }, 'u-1')).toThrow(
      /CONFIRM_SECRET/,
    )
  })
})
