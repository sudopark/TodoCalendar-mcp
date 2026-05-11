import { z } from 'zod'
import { ConfirmTokenError, signConfirmToken, verifyConfirmToken } from '../../confirm/token.js'
import { ToolError } from './errors.js'

export const CONFIRM_TTL_SECONDS = 5 * 60

export const confirmRequiredSchema = z
  .object({
    status: z
      .literal('confirm_required')
      .describe('Discriminator — "confirm_required" means no destructive call was made yet.'),
    message: z
      .string()
      .describe('Human-readable confirmation prompt to surface to the end user before re-calling.'),
    confirmToken: z
      .string()
      .describe(
        'Opaque token to echo back on the next call (under the same arguments) to actually execute the deletion. Expires in 5 minutes.',
      ),
    action: z.string().describe('The tool name this token is scoped to.'),
    target: z
      .record(z.string(), z.unknown())
      .describe('The arguments this token is bound to — must match on re-call.'),
  })
  .describe(
    'First-call envelope for CONFIRM-gated tools. No backend mutation has occurred — re-call the same tool with the same args plus confirmToken to actually delete.',
  )

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
