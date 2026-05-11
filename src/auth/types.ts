export type Scope = 'read:calendar' | 'write:calendar'

export interface Auth {
  userId: string
  scopes: string[]
}
