export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface OpenApiErrorBody {
  status: number
  code: string
  message: string
}
