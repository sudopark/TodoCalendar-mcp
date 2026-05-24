import type { RequestHandler } from 'express'
import { tools } from '../tools/index.js'
import type { AuthedRequest } from './auth.js'
import { buildWwwAuthenticate, metadataUrlFrom } from './wwwAuthenticate.js'

// JSON-RPC body에서 tools/call 인 호출들의 필요 scope 집합을 모음.
// batch도 처리 (array body). 그 외 method(initialize, tools/list 등)는 scope 무관.
export const requiredScopesFor = (body: unknown): readonly string[] => {
  if (body === null || typeof body !== 'object') return []
  const items = Array.isArray(body) ? body : [body]
  const acc = new Set<string>()
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const rec = item as { method?: unknown; params?: unknown }
    if (rec.method !== 'tools/call') continue
    const params = rec.params as { name?: unknown } | undefined
    const name = params?.name
    if (typeof name !== 'string') continue
    const tool = tools[name]
    if (tool === undefined) continue
    for (const s of tool.scopes) acc.add(s)
  }
  return [...acc]
}

export interface ScopeEnforceOptions {
  /** WWW-Authenticate realm·resource_metadata 빌드용. */
  canonicalUri?: string
}

// RFC 6750 §3.1 scope enforce — transport 단계에서 403 + WWW-Authenticate.
// LLM client가 표준 흐름으로 scope 재인가 진행 가능.
// mcpAuth(req.auth 세팅) + express.json(req.body 채움) 다음에 mount.
export const scopeEnforce = (options: ScopeEnforceOptions = {}): RequestHandler => {
  const metadataUrl = metadataUrlFrom(options.canonicalUri)
  return (req, res, next): void => {
    const auth = (req as AuthedRequest).auth
    if (auth === undefined) {
      next(new Error('scopeEnforce: req.auth not populated — mount mcpAuth before scopeEnforce'))
      return
    }
    const required = requiredScopesFor(req.body)
    const missing = required.filter((s) => !auth.scopes.includes(s))
    if (missing.length === 0) {
      next()
      return
    }
    res.setHeader(
      'WWW-Authenticate',
      buildWwwAuthenticate(options.canonicalUri, metadataUrl, {
        error: 'insufficient_scope',
        description: 'token lacks required scope',
        scope: missing.join(' '),
      }),
    )
    res.status(403).json({ error: 'insufficient_scope' })
  }
}
