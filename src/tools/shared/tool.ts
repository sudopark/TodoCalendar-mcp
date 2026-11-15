import type { z } from 'zod'
import type { Auth, Scope } from '../../auth/types.js'

/**
 * MCP `tools/list` annotation — Claude Connectors 디렉토리 제출 요건이라 전 tool 필수 (#72).
 * SDK의 `ToolAnnotations`를 쓰지 않고 좁게 다시 정의한다 — `tools/`는 npm 공개 면이고,
 * 여기서 쓰는 세 필드 외에는 노출하지 않는다.
 */
export interface ToolAnnotations {
  /** 사람이 읽는 라벨. */
  readonly title: string
  /** 조회 전용이면 true. */
  readonly readOnlyHint: boolean
  /**
   * 대상 또는 그 회차 자체가 사라지는 변경이면 true. 필드만 바뀌고 대상이 남는 변경은 false.
   * 스펙 기본값이 true라서 비파괴 write에도 명시해야 create_*가 파괴적으로 읽히지 않는다.
   * readOnlyHint가 true면 의미가 없어 생략한다.
   */
  readonly destructiveHint?: boolean
}

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
  readonly annotations: ToolAnnotations
  readonly inputSchema: z.ZodType<I>
  readonly outputSchema: z.ZodType<O>
  execute(auth: Auth, args: unknown): Promise<O>
}

export type AnyToolDefinition = ToolDefinition<unknown, unknown>
