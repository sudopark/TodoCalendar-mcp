import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { foremostEventSchema, statusOkSchema } from './shared/schemas.js'
import { augmentIso } from './shared/time.js'
import type { ToolDefinition } from './shared/tool.js'

const FOREMOST_PATH = '/v2/open/foremost/event'

const getForemostEventInput = z
  .object({})
  .describe('No input — returns the current foremost event for the authenticated user.')

type GetForemostEventInput = z.infer<typeof getForemostEventInput>

const getForemostEventOutput = foremostEventSchema

type GetForemostEventOutput = z.infer<typeof getForemostEventOutput>

export const getForemostEvent: ToolDefinition<GetForemostEventInput, GetForemostEventOutput> = {
  name: 'get_foremost_event',
  scopes: ['read:calendar'],
  description: `\
Fetch the user's current "foremost" event — the single most important upcoming todo or schedule pinned by the user. Returns the pointer { event_id, is_todo, event } with the target embedded, or {} when nothing is pinned.

The 'event' field is the full todo (when is_todo=true) or schedule (when is_todo=false) object, including the same '*_iso' siblings on timestamps. Use this when the user asks about "the most important thing" / "what's pinned" / "what's foremost".`,
  inputSchema: getForemostEventInput,
  outputSchema: getForemostEventOutput,
  execute: async (auth: Auth): Promise<GetForemostEventOutput> => {
    try {
      return augmentIso(
        await callOpenApi<GetForemostEventOutput>(auth, 'GET', FOREMOST_PATH),
      ) as GetForemostEventOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const setForemostEventInput = z
  .object({
    event_id: z
      .string()
      .min(1)
      .describe(
        'UUID of the todo or schedule to pin as foremost. Must belong to the authenticated user. Empty string is rejected.',
      ),
    is_todo: z
      .boolean()
      .describe(
        'true → event_id refers to a todo (came from get_todos); false → schedule (came from get_schedules). The openAPI does not auto-detect.',
      ),
  })
  .describe(
    'Foremost-pin payload. The owner is taken from the auth context — never pass userId here.',
  )

type SetForemostEventInput = z.infer<typeof setForemostEventInput>

const setForemostEventOutput = foremostEventSchema

type SetForemostEventOutput = z.infer<typeof setForemostEventOutput>

export const setForemostEvent: ToolDefinition<SetForemostEventInput, SetForemostEventOutput> = {
  name: 'set_foremost_event',
  scopes: ['write:calendar'],
  description: `\
Pin a todo or schedule as the user's "foremost" event — replaces any previous pin (upsert). Returns the new foremost pointer { event_id, is_todo, event } with the target embedded; the embedded 'event' carries the same '*_iso' siblings as the source todo/schedule.

Set 'is_todo' based on which list event_id came from (get_todos → true; get_schedules → false). The openAPI does not auto-detect the kind.`,
  inputSchema: setForemostEventInput,
  outputSchema: setForemostEventOutput,
  execute: async (auth: Auth, args: unknown): Promise<SetForemostEventOutput> => {
    const body = setForemostEventInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<SetForemostEventOutput>(auth, 'PUT', FOREMOST_PATH, body),
      ) as SetForemostEventOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const clearForemostEventInput = z
  .object({})
  .describe(
    'No input — unsets the current foremost pin for the authenticated user. The pinned todo/schedule itself is NOT deleted; only the foremost pointer is cleared. Re-callable to re-pin via set_foremost_event.',
  )

type ClearForemostEventInput = z.infer<typeof clearForemostEventInput>

const clearForemostEventOutput = statusOkSchema

type ClearForemostEventOutput = z.infer<typeof clearForemostEventOutput>

export const clearForemostEvent: ToolDefinition<
  ClearForemostEventInput,
  ClearForemostEventOutput
> = {
  name: 'clear_foremost_event',
  scopes: ['write:calendar'],
  description: `\
Unset the user's foremost pin — removes the pointer only. The previously pinned todo or schedule is NOT deleted and remains in get_todos / get_schedules. Returns { status: 'ok' }.

Not CONFIRM-gated: this is a pointer-clear, trivially reversible via set_foremost_event. To delete the underlying event itself, use delete_todo / delete_schedule (which are CONFIRM-gated).`,
  inputSchema: clearForemostEventInput,
  outputSchema: clearForemostEventOutput,
  execute: async (auth: Auth): Promise<ClearForemostEventOutput> => {
    try {
      return await callOpenApi<ClearForemostEventOutput>(auth, 'DELETE', FOREMOST_PATH)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
