/**
 * Thrown by `resolveAuthFromExtra` when the MCP handler is invoked without a valid
 * AuthInfo. By the time a request reaches the handler, the transport-level auth
 * middleware should have rejected it (HTTP 401) — reaching here means an invariant
 * violation upstream, not a normal client error. Bubbles to the SDK as a JSON-RPC
 * Internal Error (-32603) instead of becoming a CallToolResult{isError}, so the
 * symptom is visibly distinct from "tool ran and reported an error".
 */
export class AuthInvariantError extends Error {
  override readonly name = 'AuthInvariantError'
  /** Internal-only detail for server logs. Not exposed via the bubbled message. */
  readonly detail: string
  constructor(detail: string) {
    super('[invariant] auth context missing — server misconfigured')
    this.detail = detail
  }
}
