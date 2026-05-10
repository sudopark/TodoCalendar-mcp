import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { doneTodoSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const DEFAULT_SIZE = 50
const MAX_SIZE = 200

const getDoneTodosInput = z
  .object({
    size: z
      .number()
      .int()
      .min(1)
      .max(MAX_SIZE)
      .default(DEFAULT_SIZE)
      .describe(
        `Page size (1..${MAX_SIZE}, default ${DEFAULT_SIZE}). The server returns up to this many done-todos.`,
      ),
    cursor: z
      .number()
      .optional()
      .describe(
        'Opaque pagination cursor — pass the value of `next_cursor` from the previous response to fetch the next page. Omit on first call.',
      ),
  })
  .describe('Pagination cursor based on the most recently returned `next_cursor`.')

type GetDoneTodosInput = z.infer<typeof getDoneTodosInput>

const getDoneTodosOutput = z
  .object({
    dones: z.array(doneTodoSchema),
    next_cursor: z
      .number()
      .nullish()
      .describe('Pass back as `cursor` to fetch the next page. Null/absent when no more pages.'),
  })
  .describe('Paginated list of completed todos.')

type GetDoneTodosOutput = z.infer<typeof getDoneTodosOutput>

export const getDoneTodos: ToolDefinition<GetDoneTodosInput, GetDoneTodosOutput> = {
  name: 'get_done_todos',
  description: `\
Fetch completed (done) todos for the authenticated user, ordered by completion time (newest first), paginated by cursor.

Use 'cursor' to fetch the next page — pass the 'next_cursor' value from the previous response. All timestamps in the response are Unix epoch seconds (UTC).`,
  inputSchema: getDoneTodosInput,
  outputSchema: getDoneTodosOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetDoneTodosOutput> => {
    const { size, cursor } = getDoneTodosInput.parse(args)
    const qs = cursor === undefined ? `?size=${size}` : `?size=${size}&cursor=${cursor}`
    try {
      return await callOpenApi<GetDoneTodosOutput>(auth, 'GET', `/v2/open/todos/dones/${qs}`)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
