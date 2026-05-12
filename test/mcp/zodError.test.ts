import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formatZodError } from '../../src/mcp/zodError.js'

const collectError = (parse: () => unknown): z.ZodError => {
  try {
    parse()
  } catch (e) {
    if (e instanceof z.ZodError) return e
    throw new Error('expected ZodError')
  }
  throw new Error('expected throw')
}

describe('formatZodError', () => {
  it('단일 issue — path: message 형식', () => {
    const schema = z.object({ name: z.string() })
    const err = collectError(() => schema.parse({ name: 42 }))
    expect(formatZodError(err)).toBe('name: Invalid input: expected string, received number')
  })

  it('중첩 path — dot로 join', () => {
    const schema = z.object({ user: z.object({ age: z.number() }) })
    const err = collectError(() => schema.parse({ user: { age: 'x' } }))
    expect(formatZodError(err)).toContain('user.age:')
  })

  it('다중 issue — 세미콜론으로 join (caller가 한 번에 모든 위반 확인)', () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const err = collectError(() => schema.parse({ name: 1, age: 'x' }))
    const msg = formatZodError(err)
    expect(msg).toContain('name:')
    expect(msg).toContain('age:')
    expect(msg).toContain('; ')
  })

  it('root 레벨 이슈 (path 비어있음) — "(root)"로 표기', () => {
    const schema = z.string()
    const err = collectError(() => schema.parse(42))
    expect(formatZodError(err)).toMatch(/^\(root\):/)
  })

  it('issues 비어있는 ZodError — fallback 메시지', () => {
    const empty = new z.ZodError([])
    expect(formatZodError(empty)).toBe('Invalid input')
  })
})
