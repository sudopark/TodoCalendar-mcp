import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { doneTodoSchema, eventTimeSchema } from './shared/schemas.js'
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
      .nullish()
      .describe(
        'Opaque pagination cursor — pass the `next_cursor` value from the previous response to fetch the next page. Omit on the first call. Null is also accepted (treated as no cursor) so that callers can round-trip the response value verbatim.',
      ),
  })
  .describe('Page size and optional pagination cursor (from the previous response\'s `next_cursor`).')

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

const updateDoneTodoInput = z
  .object({
    done_todo_id: z.string().min(1).describe('UUID of the done-todo to update.'),
    name: z.string().optional().describe('New display name. Omit to keep unchanged.'),
    event_time: eventTimeSchema
      .optional()
      .describe('Replacement event_time. Omit to keep unchanged.'),
    event_tag_id: z
      .string()
      .optional()
      .describe('Tag uuid to reassign this done-todo to. Omit to keep unchanged.'),
  })
  .describe(
    'Body for updating a done todo. Only name, event_time, and event_tag_id can be edited; other fields (completion time, origin id, etc.) are immutable here.',
  )

type UpdateDoneTodoInput = z.infer<typeof updateDoneTodoInput>

const updateDoneTodoOutput = doneTodoSchema

type UpdateDoneTodoOutput = z.infer<typeof updateDoneTodoOutput>

export const updateDoneTodo: ToolDefinition<UpdateDoneTodoInput, UpdateDoneTodoOutput> = {
  name: 'update_done_todo',
  description: `\
Update editable fields of a completed (done) todo: name, event_time, event_tag_id. Returns the updated done todo.

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). All timestamps are Unix epoch seconds (UTC). To bring a done todo back to the active list, use revert_done_todo instead.`,
  inputSchema: updateDoneTodoInput,
  outputSchema: updateDoneTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<UpdateDoneTodoOutput> => {
    const { done_todo_id, ...body } = updateDoneTodoInput.parse(args)
    try {
      return await callOpenApi<UpdateDoneTodoOutput>(
        auth,
        'PUT',
        `/v2/open/todos/dones/${encodeURIComponent(done_todo_id)}`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

export const getDoneTodos: ToolDefinition<GetDoneTodosInput, GetDoneTodosOutput> = {
  name: 'get_done_todos',
  description: `\
Fetch completed (done) todos for the authenticated user, ordered by completion time (newest first), paginated by cursor.

Use 'cursor' to fetch the next page — pass the 'next_cursor' value from the previous response. All timestamps in the response are Unix epoch seconds (UTC).`,
  inputSchema: getDoneTodosInput,
  outputSchema: getDoneTodosOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetDoneTodosOutput> => {
    const { size, cursor } = getDoneTodosInput.parse(args)
    const qs = new URLSearchParams({ size: String(size) })
    if (cursor !== undefined && cursor !== null) qs.set('cursor', String(cursor))
    try {
      return await callOpenApi<GetDoneTodosOutput>(
        auth,
        'GET',
        `/v2/open/todos/dones/?${qs.toString()}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
