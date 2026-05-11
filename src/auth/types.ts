export type Scope = 'read:calendar' | 'write:calendar'

export interface Auth {
  userId: string
  scopes: string[]
  // OAuth client_id (token 발급 client 식별). dev mode/lib 호출 경로는 undefined.
  clientId?: string
}
