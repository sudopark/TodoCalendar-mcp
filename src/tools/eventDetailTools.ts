import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventDetailSchema, statusOkSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const getEventDetailsInput = z
  .object({
    event_id: z
      .string()
      .min(1)
      .describe(
        'UUID of the todo, schedule, or done-todo whose detail metadata is requested. Empty string is rejected to avoid colliding with the list endpoint.',
      ),
    is_done: z
      .boolean()
      .describe(
        'Set to true when event_id refers to a done-todo (i.e. it came from get_done_todos), false for active todos and schedules. The caller is expected to know this from the prior fetch context.',
      ),
  })
  .describe('Look up detail metadata (place / url / memo) for a specific event.')

type GetEventDetailsInput = z.infer<typeof getEventDetailsInput>

const getEventDetailsOutput = eventDetailSchema

type GetEventDetailsOutput = z.infer<typeof getEventDetailsOutput>

export const getEventDetails: ToolDefinition<GetEventDetailsInput, GetEventDetailsOutput> = {
  name: 'get_event_details',
  scopes: ['read:calendar'],
  description: `\
Fetch optional detail metadata (place, url, memo) for a specific event.

The active vs done routing is governed by the 'is_done' input flag — set it based on which list the event came from (get_todos / get_schedules → false; get_done_todos → true).`,
  inputSchema: getEventDetailsInput,
  outputSchema: getEventDetailsOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetEventDetailsOutput> => {
    const { event_id, is_done } = getEventDetailsInput.parse(args)
    const path = is_done
      ? `/v2/open/event_details/done/${encodeURIComponent(event_id)}`
      : `/v2/open/event_details/${encodeURIComponent(event_id)}`
    try {
      return await callOpenApi<GetEventDetailsOutput>(auth, 'GET', path)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const eventDetailInput = z
  .object({
    place: z.string().optional().describe('Optional place / location string.'),
    url: z.string().optional().describe('Optional URL associated with the event.'),
    memo: z.string().optional().describe('Optional free-form memo.'),
  })
  .describe(
    'Detail metadata payload. All fields are optional — server-side this is an upsert (omitted fields are unset on the stored detail).',
  )

const setEventDetailInput = z
  .object({
    event_id: z
      .string()
      .min(1)
      .describe(
        'UUID of the todo, schedule, or done-todo whose detail metadata is being upserted. Empty string is rejected to avoid hitting the wrong route.',
      ),
    is_done: z
      .boolean()
      .describe(
        "Set to true when event_id refers to a done-todo (came from get_done_todos), false for active todos and schedules. Routes the request to the matching collection — the server doesn't auto-detect.",
      ),
    detail: eventDetailInput,
  })
  .describe('Upsert (PUT) the detail metadata for one event. The owner is taken from the auth context.')

type SetEventDetailInput = z.infer<typeof setEventDetailInput>

const setEventDetailOutput = eventDetailSchema

type SetEventDetailOutput = z.infer<typeof setEventDetailOutput>

export const setEventDetail: ToolDefinition<SetEventDetailInput, SetEventDetailOutput> = {
  name: 'set_event_detail',
  scopes: ['write:calendar'],
  description: `\
Upsert detail metadata (place, url, memo) for a specific event.

The active vs done routing is governed by the 'is_done' input flag — set it based on which list the event came from (active todos/schedules → false; done todos → true). All fields inside 'detail' are optional; this is an upsert and omitted fields are unset.`,
  inputSchema: setEventDetailInput,
  outputSchema: setEventDetailOutput,
  execute: async (auth: Auth, args: unknown): Promise<SetEventDetailOutput> => {
    const { event_id, is_done, detail } = setEventDetailInput.parse(args)
    const path = is_done
      ? `/v2/open/event_details/done/${encodeURIComponent(event_id)}`
      : `/v2/open/event_details/${encodeURIComponent(event_id)}`
    try {
      return await callOpenApi<SetEventDetailOutput>(auth, 'PUT', path, detail)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const deleteEventDetailInput = z
  .object({
    event_id: z
      .string()
      .min(1)
      .describe(
        'UUID of the todo, schedule, or done-todo whose detail metadata should be deleted. Empty string is rejected.',
      ),
    is_done: z
      .boolean()
      .describe(
        "Set to true when event_id refers to a done-todo (came from get_done_todos), false for active todos and schedules. Routes the request to the matching collection — the server doesn't auto-detect.",
      ),
  })
  .describe('Remove the detail metadata attached to one event. The parent event (todo / schedule / done-todo) is NOT deleted.')

type DeleteEventDetailInput = z.infer<typeof deleteEventDetailInput>

const deleteEventDetailOutput = statusOkSchema

type DeleteEventDetailOutput = z.infer<typeof deleteEventDetailOutput>

export const deleteEventDetail: ToolDefinition<DeleteEventDetailInput, DeleteEventDetailOutput> = {
  name: 'delete_event_detail',
  scopes: ['write:calendar'],
  description: `\
Delete the detail metadata (place / url / memo) attached to a specific event. Returns { status: 'ok' }.

This removes only the detail record — the parent event (todo / schedule / done-todo) remains. To delete the parent event itself, use delete_todo / delete_schedule / delete_done_todo. If the user wants to bring a done todo back to the active list (not just clear its detail), use revert_done_todo instead — this tool only removes place/url/memo metadata.

The active vs done routing is governed by the 'is_done' input flag — set it based on which list the event came from (active todos/schedules → false; done todos → true).`,
  inputSchema: deleteEventDetailInput,
  outputSchema: deleteEventDetailOutput,
  execute: async (auth: Auth, args: unknown): Promise<DeleteEventDetailOutput> => {
    const { event_id, is_done } = deleteEventDetailInput.parse(args)
    const path = is_done
      ? `/v2/open/event_details/done/${encodeURIComponent(event_id)}`
      : `/v2/open/event_details/${encodeURIComponent(event_id)}`
    try {
      return await callOpenApi<DeleteEventDetailOutput>(auth, 'DELETE', path)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
