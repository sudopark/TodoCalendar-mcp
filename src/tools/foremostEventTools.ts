import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { NotFoundError } from '../openapi/errors.js'
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
Fetch the user's current "foremost" event — the single most important todo or schedule pinned by the user. Returns { event_id, is_todo, event } with the target embedded, or {} when nothing is pinned.`,
  docs: `\
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
        'UUID of the todo or schedule to pin as foremost — either kind can be pinned. Must belong to the authenticated user. Empty string is rejected.',
      ),
  })
  .describe(
    'Foremost-pin payload. The owner is taken from the auth context — never pass userId here.',
  )

type SetForemostEventInput = z.infer<typeof setForemostEventInput>

const setForemostEventOutput = foremostEventSchema

type SetForemostEventOutput = z.infer<typeof setForemostEventOutput>

const isTodoEvent = async (auth: Auth, eventId: string): Promise<boolean> => {
  const id = encodeURIComponent(eventId)
  try {
    await callOpenApi(auth, 'GET', `/v2/open/todos/${id}`)
    return true
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e
  }
  try {
    await callOpenApi(auth, 'GET', `/v2/open/schedules/${id}`)
    return false
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e
    throw new NotFoundError(`no todo or schedule with event_id ${eventId}`)
  }
}

export const setForemostEvent: ToolDefinition<SetForemostEventInput, SetForemostEventOutput> = {
  name: 'set_foremost_event',
  // 종류 판별을 위해 todo/schedule 단건 조회를 먼저 하므로 read도 필요하다.
  scopes: ['read:calendar', 'write:calendar'],
  description: `\
Pin a todo or schedule as the user's "foremost" event — replaces any previous pin (upsert). Pass only event_id; whether it is a todo or a schedule is detected automatically.`,
  docs: `\
Pin a todo or schedule as the user's "foremost" event — replaces any previous pin (upsert). Returns the new foremost pointer { event_id, is_todo, event } with the target embedded; the embedded 'event' carries the same '*_iso' siblings as the source todo/schedule.

Either a todo or a schedule can be pinned — the user may say "pin this schedule as my most important todo"; just pass the event's id. The tool looks the id up and sets the kind itself, so 'is_todo' is not an input. Fails with NotFound (and pins nothing) when event_id is neither a todo nor a schedule of the user.`,
  inputSchema: setForemostEventInput,
  outputSchema: setForemostEventOutput,
  execute: async (auth: Auth, args: unknown): Promise<SetForemostEventOutput> => {
    const { event_id } = setForemostEventInput.parse(args)
    try {
      const is_todo = await isTodoEvent(auth, event_id)
      return augmentIso(
        await callOpenApi<SetForemostEventOutput>(auth, 'PUT', FOREMOST_PATH, {
          event_id,
          is_todo,
        }),
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
Unset the user's foremost pin — removes the pointer only; the pinned todo/schedule itself is NOT deleted. Returns { status: 'ok' }.`,
  docs: `\
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
