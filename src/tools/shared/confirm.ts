import { z } from 'zod'
import { ConfirmTokenError, signConfirmToken, verifyConfirmToken } from '../../confirm/token.js'
import { ToolError } from './errors.js'

export const CONFIRM_TTL_SECONDS = 5 * 60

// MCP가 자체 생성하는 confirm 게이트 응답. openAPI raw passthrough 대상 아님 — §6과 충돌 없음.
// 실제 destructive 호출은 2단계(confirmToken 동봉 재호출)에서만 일어나며, 그때 응답은 openAPI raw 그대로 통과.
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
        'Opaque token to echo back on the next call to actually execute. Expires in 5 minutes. Verification is stateless — the same token can be re-used until expiry against the SAME args under the SAME user, so do not treat it as single-use; re-issue a fresh token if intent changes.',
      ),
    action: z.string().describe('The tool name this token is scoped to.'),
    target: z
      .record(z.string(), z.unknown())
      .describe(
        'The arguments this token is bound to. On re-call, pass the SAME arguments that appear under `target` (alongside `confirmToken`) — do NOT mutate `target` itself.',
      ),
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
