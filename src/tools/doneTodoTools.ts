import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import {
  doneTodoSchema,
  eventDetailSchema,
  eventTimeSchema,
  statusOkSchema,
  todoSchema,
} from './shared/schemas.js'
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
        "Pagination cursor (Unix epoch seconds) — pass the last returned item's `done_at` to fetch items strictly older than that timestamp. Omit on the first call. Null is accepted (treated as no cursor) for round-trip convenience.",
      ),
  })
  .describe("Page size and optional pagination cursor (last item's done_at on the previous page).")

type GetDoneTodosInput = z.infer<typeof getDoneTodosInput>

export const getDoneTodosOutput = z
  .array(doneTodoSchema)
  .describe(
    'Done todos ordered by done_at desc. For pagination, pass the last item\'s done_at as `cursor` on the next call. When the returned array length is < size, no more pages.',
  )

type GetDoneTodosOutput = z.infer<typeof getDoneTodosOutput>

export const getDoneTodos: ToolDefinition<GetDoneTodosInput, GetDoneTodosOutput> = {
  name: 'get_done_todos',
  scopes: ['read:calendar'],
  description: `\
List / fetch / show / get completed (done / finished / closed / past) todos for the authenticated user — history of what's been checked off, ordered by completion time (newest first), paginated by cursor.

Response is an array of done todos. For pagination, pass the last item's 'done_at' as 'cursor' on the next call (cursor is excluded — items strictly older than cursor are returned). When the returned array length is less than 'size', there are no more pages. All timestamps in the response are Unix epoch seconds (UTC).`,
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
  scopes: ['write:calendar'],
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

const revertDoneTodoInput = z
  .object({
    done_todo_id: z
      .string()
      .min(1)
      .describe('UUID of the done-todo to revert back to active.'),
  })
  .describe(
    'Revert a previously-completed (done) todo back to the active todo list. The done record is removed and a new active todo is created with any preserved detail.',
  )

type RevertDoneTodoInput = z.infer<typeof revertDoneTodoInput>

export const revertDoneTodoOutput = z
  .object({
    todo: todoSchema.describe('The newly-activated todo created from the reverted done-todo.'),
    detail: eventDetailSchema
      .nullish()
      .describe(
        'Event detail (place/url/memo) carried back to the new active todo. Null when no detail was attached.',
      ),
  })
  .describe('Result of reverting a done-todo: the new active todo and any carried-over detail.')

type RevertDoneTodoOutput = z.infer<typeof revertDoneTodoOutput>

export const revertDoneTodo: ToolDefinition<RevertDoneTodoInput, RevertDoneTodoOutput> = {
  name: 'revert_done_todo',
  scopes: ['write:calendar'],
  description: `\
Revert a completed (done) todo back to the active list. Returns the new active todo and any carried-over event detail.

This deletes the done-todo record and creates a fresh active todo with the preserved name/event_time/event_tag_id. Use this when a completion was a mistake or needs to be redone.`,
  inputSchema: revertDoneTodoInput,
  outputSchema: revertDoneTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<RevertDoneTodoOutput> => {
    const { done_todo_id } = revertDoneTodoInput.parse(args)
    try {
      return await callOpenApi<RevertDoneTodoOutput>(
        auth,
        'POST',
        `/v2/open/todos/dones/${encodeURIComponent(done_todo_id)}/revert`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const deleteDoneTodoInput = z
  .object({
    done_todo_id: z.string().min(1).describe('UUID of the done-todo to delete.'),
  })
  .describe(
    'Permanently delete a completed (done) todo record. The active list is unaffected. If you want to restore the todo to the active list instead, use revert_done_todo.',
  )

type DeleteDoneTodoInput = z.infer<typeof deleteDoneTodoInput>

const deleteDoneTodoOutput = statusOkSchema

type DeleteDoneTodoOutput = z.infer<typeof deleteDoneTodoOutput>

export const deleteDoneTodo: ToolDefinition<DeleteDoneTodoInput, DeleteDoneTodoOutput> = {
  name: 'delete_done_todo',
  scopes: ['write:calendar'],
  description: `\
Permanently delete a completed (done) todo record. Returns { status: 'ok' }.

This does NOT bring the todo back to the active list — for that, use revert_done_todo. Use delete_done_todo only when the record should be purged outright.`,
  inputSchema: deleteDoneTodoInput,
  outputSchema: deleteDoneTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<DeleteDoneTodoOutput> => {
    const { done_todo_id } = deleteDoneTodoInput.parse(args)
    try {
      return await callOpenApi<DeleteDoneTodoOutput>(
        auth,
        'DELETE',
        `/v2/open/todos/dones/${encodeURIComponent(done_todo_id)}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
