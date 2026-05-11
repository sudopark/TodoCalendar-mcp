import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerNotification,
  type ServerRequest,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Auth } from '../auth/types.js'
import { tools as defaultTools, type AnyToolDefinition } from '../tools/index.js'
import { ToolError } from '../tools/shared/errors.js'
import { AuthInvariantError } from './errors.js'
import { buildCallToolResult, buildErrorResult } from './result.js'
import { toMcpTool } from './toolSchema.js'

export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>
export type AuthResolver = (extra: McpRequestExtra) => Auth

/**
 * Default resolver for HTTP transport: reads `userId` from the validated AuthInfo.extra.
 * Auth middleware writes `req.auth.extra.userId`; SDK propagates it to handlers as `extra.authInfo`.
 *
 * Throws `AuthInvariantError` (not a generic Error) when auth is absent, because at
 * MCP-handler depth the transport-level 401 gate should already have run. Reaching here
 * means a wiring bug, not a user error — bubbling distinct exception lets server.ts /
 * tests catch it explicitly.
 */
export const resolveAuthFromExtra: AuthResolver = (extra) => {
  const extraRecord = extra.authInfo?.extra as { userId?: unknown; scopes?: unknown } | undefined
  const userId = extraRecord?.userId
  if (typeof userId !== 'string' || userId === '') {
    throw new AuthInvariantError('extra.authInfo.extra.userId not populated')
  }
  const scopesRaw = extraRecord?.scopes
  const scopes = Array.isArray(scopesRaw)
    ? scopesRaw.filter((s): s is string => typeof s === 'string')
    : []
  return { userId, scopes }
}

export interface CreateMcpServerOptions {
  tools?: Record<string, AnyToolDefinition>
  resolveAuth?: AuthResolver
  serverInfo?: { name: string; version: string }
}

// zod → JSON Schema 변환은 무손실이지만 0이 아닌 비용 (재귀·deepclone). Default tool
// registry는 변하지 않으므로 module-load 시 한 번만 계산해서 stateless per-request
// 핸들러에서 재사용. 외부에서 tools를 주입한 케이스(테스트 등)는 그대로 매번 변환.
const DEFAULT_MCP_TOOLS: readonly Tool[] = Object.values(defaultTools).map(toMcpTool)

export const createMcpServer = (options: CreateMcpServerOptions = {}): Server => {
  const tools = options.tools ?? defaultTools
  const resolveAuth = options.resolveAuth ?? resolveAuthFromExtra
  const info = options.serverInfo ?? { name: 'todocalendar-mcp', version: '0.0.1' }
  const mcpTools =
    options.tools !== undefined ? Object.values(options.tools).map(toMcpTool) : DEFAULT_MCP_TOOLS

  const server = new Server(info, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...mcpTools] }))

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = tools[req.params.name]
    if (tool === undefined) {
      return buildErrorResult(new ToolError(404, 'UnknownTool', `Unknown tool: ${req.params.name}`))
    }
    let auth: Auth
    try {
      auth = resolveAuth(extra)
    } catch (e) {
      // Invariant violations bubble to SDK → JSON-RPC -32603 (Internal Error) instead
      // of being silently smashed into a CallToolResult{isError}. Caller can tell apart
      // "tool reported an error" vs "server is misconfigured".
      if (e instanceof AuthInvariantError) throw e
      return buildErrorResult(e)
    }
    const missing = tool.scopes.filter((s) => !auth.scopes.includes(s))
    if (missing.length > 0) {
      return buildErrorResult(
        new ToolError(
          403,
          'InsufficientScope',
          `The auth token lacks the required scope. (requires: ${missing.join(' ')})`,
        ),
      )
    }
    try {
      const result = await tool.execute(auth, req.params.arguments)
      return buildCallToolResult(result)
    } catch (e) {
      return buildErrorResult(e)
    }
  })

  return server
}
