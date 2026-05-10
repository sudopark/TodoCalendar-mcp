import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventDetailSchema } from './shared/schemas.js'
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
