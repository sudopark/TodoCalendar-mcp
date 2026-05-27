import type { RequestHandler } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { hashUserId } from '../internal/hashUserId.js'
import { createMcpServer } from './server.js'

export interface McpHandlerOptions {
  /** DNS rebinding 보호 화이트리스트. undefined면 protection 비활성. 운영 환경에서 반드시 주입. */
  allowedHosts?: string[]
}

// MCP per-request handler — Streamable HTTP 권장(SEP-1442) stateless 패턴.
// 매 POST 요청에 fresh Server+Transport를 만들고 res close 시 정리. 세션 메모리 0,
// scale-out·serverless 친화. mcpAuth가 req.auth를 세팅했다고 가정.
export const mcpRequestHandler = (options: McpHandlerOptions = {}): RequestHandler => {
  return async (req, res, next): Promise<void> => {
    const auth = (req as AuthedRequest).auth
    if (auth === undefined) {
      next(new Error('mcpRequestHandler: req.auth not populated — mount mcpAuth before this handler'))
      return
    }
    // 사용량 집계용 구조화 로그. auth/scope 통과 직후·MCP 처리 직전 단일 진입점에서 한 줄.
    // Cloud Logging이 stdout JSON을 jsonPayload로 자동 파싱 → Log Analytics에서
    // distinct(userIdHash) over 1h로 unique user 집계. raw 전체 호출 수는 Cloud Run
    // request_count metric이 무료로 잡아주므로 본 로그는 user/method 차원만 추가.
    // userId가 비면 mcpAuth가 set하지 않은 비정상 경로 — 카운트에 잡지 않고 skip.
    const userId = (auth.extra as { userId?: string } | undefined)?.userId
    if (userId !== undefined) {
      const body = req.body as { method?: string; params?: { name?: string } } | undefined
      const method = body?.method
      const toolName = method === 'tools/call' ? body?.params?.name : undefined
      console.log(
        JSON.stringify({
          severity: 'INFO',
          event: 'mcp_call',
          userIdHash: hashUserId(userId),
          method,
          toolName,
        }),
      )
    }
    const mcpServer = createMcpServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: options.allowedHosts !== undefined,
      allowedHosts: options.allowedHosts,
    })
    // res.on('close')는 정상 종료·클라이언트 disconnect 둘 다 발화. 어느 쪽이든 동일 cleanup.
    // close()는 throw할 일이 거의 없지만 unhandled rejection 방지 차원에서 swallow.
    res.on('close', () => {
      transport.close().catch(() => {})
      mcpServer.close().catch(() => {})
    })
    try {
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      next(e)
    }
  }
}
