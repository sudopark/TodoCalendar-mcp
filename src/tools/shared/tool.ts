import type { z } from 'zod'
import type { Auth } from '../../auth/types.js'

// `outputSchema` is documentation-only — it surfaces field-level units / discriminator
// hints to the LLM via MCP. Tools MUST NOT call `.parse(result)` on it: per CLAUDE.md §6,
// openAPI raw payloads pass through untouched (round-trip safety, audit log fidelity).
export interface ToolDefinition<I, O> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<I>
  readonly outputSchema: z.ZodType<O>
  execute(auth: Auth, args: unknown): Promise<O>
}

export type AnyToolDefinition = ToolDefinition<unknown, unknown>
