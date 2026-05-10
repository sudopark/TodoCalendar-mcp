import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { requireEnv } from '../internal/env.js'

const TTL_SECONDS = 5 * 60

// args는 plain JSON value를 가정. Date는 toISOString으로 정규화.
// BigInt/Map/Set 등은 JSON 직렬화 단계에서 throw — 호출자가 zod로 거르고 들어오는 게 정상 경로.
const canonical = (v: unknown): string => {
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

const computeArgsHash = (args: unknown): string =>
  crypto.createHash('sha256').update(canonical(args)).digest('hex')

export type ConfirmTokenReason = 'Expired' | 'ToolMismatch' | 'ArgsMismatch' | 'Invalid'

export class ConfirmTokenError extends Error {
  constructor(
    public readonly reason: ConfirmTokenReason,
    message: string,
  ) {
    super(message)
    this.name = 'ConfirmTokenError'
  }
}

export const signConfirmToken = (tool: string, args: unknown): string => {
  return jwt.sign(
    { tool, argsHash: computeArgsHash(args) },
    requireEnv('CONFIRM_SECRET'),
    { algorithm: 'HS256', expiresIn: TTL_SECONDS },
  )
}

export const verifyConfirmToken = (token: string, tool: string, args: unknown): void => {
  let decoded: jwt.JwtPayload
  try {
    const result = jwt.verify(token, requireEnv('CONFIRM_SECRET'), {
      algorithms: ['HS256'],
    })
    if (typeof result === 'string' || result === null) {
      throw new ConfirmTokenError('Invalid', 'unexpected string payload')
    }
    decoded = result
  } catch (e) {
    if (e instanceof ConfirmTokenError) throw e
    if (e instanceof jwt.TokenExpiredError) {
      throw new ConfirmTokenError('Expired', 'confirm token expired')
    }
    throw new ConfirmTokenError(
      'Invalid',
      `confirm token invalid: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const decodedTool = typeof decoded.tool === 'string' ? decoded.tool : ''
  if (decodedTool !== tool) {
    throw new ConfirmTokenError(
      'ToolMismatch',
      `confirm token issued for "${decodedTool}", got "${tool}"`,
    )
  }

  const decodedHash = typeof decoded.argsHash === 'string' ? decoded.argsHash : ''
  if (decodedHash !== computeArgsHash(args)) {
    throw new ConfirmTokenError('ArgsMismatch', 'confirm token args mismatch')
  }
}
