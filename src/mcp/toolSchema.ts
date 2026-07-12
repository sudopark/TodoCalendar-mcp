import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { toInputJsonSchema } from '../tools/shared/jsonSchema.js'
import type { AnyToolDefinition } from '../tools/index.js'

// outputSchema는 tools/list에 싣지 않는다 (#73) — 문서화 전용 채널(CLAUDE.md §6)인데
// 페이로드의 68%를 차지했음. 응답 모양 힌트는 describe_tool 메타툴이 온디맨드로 제공.
// zod outputSchema 자체는 ToolDefinition에 유지 — describe_tool의 문서 소스.
export const toMcpTool = (def: AnyToolDefinition): Tool => ({
  name: def.name,
  description: def.description,
  inputSchema: toInputJsonSchema(def.inputSchema) as Tool['inputSchema'],
})
