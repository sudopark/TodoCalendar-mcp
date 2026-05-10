import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const TTL_SECONDS = 5 * 60

const requireEnv = (key: string): string => {
  const v = process.env[key]
  if (v === undefined || v === '') throw new Error(`Missing env: ${key}`)
  return v
}

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
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

export interface ConfirmPayload {
  tool: string
  argsHash: string
  exp: number
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
    decoded = jwt.verify(token, requireEnv('CONFIRM_SECRET'), {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload
  } catch (e) {
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
