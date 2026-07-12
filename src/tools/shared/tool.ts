import type { z } from 'zod'
import type { Auth, Scope } from '../../auth/types.js'

// `outputSchema` is documentation-only — it surfaces field-level units / discriminator
// hints to the LLM via MCP. Tools MUST NOT call `.parse(result)` on it: per CLAUDE.md §6,
// openAPI raw payloads pass through untouched (round-trip safety, audit log fidelity).
export interface ToolDefinition<I, O> {
  readonly name: string
  /** tools/list에 노출되는 탐색용 요약 (1–3문장). 목적 + 핵심 disambiguator만 (#73). */
  readonly description: string
  /** 전체 사용 가이드 — describe_tool이 온디맨드 반환. decision guide·응답 모양·시간 정책 상세는 여기로. */
  readonly docs: string
  // Required OAuth scopes for invocation. MCP RS enforces these against auth.scopes
  // at dispatch time (#23 §3). read tools get ['read:calendar']; mutation tools
  // get ['write:calendar']. Empty array is invalid — every tool must declare scope.
  readonly scopes: readonly Scope[]
  readonly inputSchema: z.ZodType<I>
  readonly outputSchema: z.ZodType<O>
  execute(auth: Auth, args: unknown): Promise<O>
}

export type AnyToolDefinition = ToolDefinition<unknown, unknown>
