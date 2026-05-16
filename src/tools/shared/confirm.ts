import { ConfirmTokenError, signConfirmToken, verifyConfirmToken } from '../../confirm/token.js'
import { ToolError } from './errors.js'

export const CONFIRM_TTL_SECONDS = 5 * 60

export const buildConfirmRequired = <A extends string, T extends Record<string, unknown>>(
  action: A,
  target: T,
  userId: string,
  message: string,
): {
  status: 'confirm_required'
  message: string
  confirmToken: string
  action: A
  target: T
} => ({
  status: 'confirm_required',
  message,
  confirmToken: signConfirmToken(action, target, userId),
  action,
  target,
})

const reasonToHttpStatus = (reason: ConfirmTokenError['reason']): number => {
  switch (reason) {
    case 'Expired':
      return 410
    case 'SubMismatch':
      return 403
    case 'ToolMismatch':
    case 'ArgsMismatch':
    case 'Invalid':
      return 400
  }
}

const reasonToCode = (reason: ConfirmTokenError['reason']): string => `Confirm${reason}`

export const ensureConfirmToken = (
  token: string,
  action: string,
  target: unknown,
  userId: string,
): void => {
  try {
    verifyConfirmToken(token, action, target, userId)
  } catch (e) {
    if (e instanceof ConfirmTokenError) {
      throw new ToolError(reasonToHttpStatus(e.reason), reasonToCode(e.reason), e.message)
    }
    throw e
  }
}
