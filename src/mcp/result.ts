import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ToolError } from '../tools/shared/errors.js'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const buildCallToolResult = (raw: unknown): CallToolResult => {
  const text = JSON.stringify(raw)
  const base: CallToolResult = { content: [{ type: 'text', text }] }
  if (isPlainObject(raw)) base.structuredContent = raw
  return base
}

// Per CLAUDE.md §6: errors are *not* round-trip raw payloads, so we ARE allowed to
// shape them for caller convenience. Embed `code`/`status` into the text channel so
// external AI agents (which often treat `_meta` as opaque MCP-internal metadata) can
// still parse them out of the LLM-visible body. `_meta` keeps the same fields for
// programmatic consumers (aiFrontAPI tool_use loop) that prefer structured access.
//
// Both ToolError and generic Error use the same JSON shape `{code, message, status?}`
// so downstream callers can `JSON.parse(content[0].text)` unconditionally.
// Generic errors get `code: 'Internal'` (no status) — distinguishable from openAPI codes.
export const buildErrorResult = (e: unknown): CallToolResult => {
  if (e instanceof ToolError) {
    const payload = { code: e.code, status: e.status, message: e.message }
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: true,
      _meta: { code: e.code, status: e.status },
    }
  }
  const message = e instanceof Error ? e.message : String(e)
  return {
    content: [{ type: 'text', text: JSON.stringify({ code: 'Internal', message }) }],
    isError: true,
  }
}
