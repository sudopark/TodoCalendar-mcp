import type { z } from 'zod'
import type { Auth } from '../../auth/types.js'

export interface ToolDefinition<I, O> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<I>
  readonly outputSchema: z.ZodType<O>
  execute(auth: Auth, args: unknown): Promise<O>
}

export type AnyToolDefinition = ToolDefinition<unknown, unknown>
