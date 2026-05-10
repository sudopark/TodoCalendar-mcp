import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventTimeSchema, repeatingSchema, scheduleSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const TS_SEC = 'Unix epoch seconds (UTC).'

const getSchedulesInput = z
  .object({
    lower: z.number().describe(`Range start (inclusive). ${TS_SEC}`),
    upper: z.number().describe(`Range end (inclusive). ${TS_SEC}`),
  })
  .describe('Both lower and upper are required (no current/uncompleted modes for schedules).')

type GetSchedulesInput = z.infer<typeof getSchedulesInput>

const getSchedulesOutput = z
  .array(scheduleSchema)
  .describe('List of schedules whose event_time overlaps the requested range.')

type GetSchedulesOutput = z.infer<typeof getSchedulesOutput>

export const getSchedules: ToolDefinition<GetSchedulesInput, GetSchedulesOutput> = {
  name: 'get_schedules',
  description: `\
Fetch schedules (calendar events) for the authenticated user that overlap the time range [lower, upper] (Unix epoch seconds, UTC).

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). 'exclude_repeatings' lists occurrence start timestamps that have been removed from the recurrence.`,
  inputSchema: getSchedulesInput,
  outputSchema: getSchedulesOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetSchedulesOutput> => {
    const { lower, upper } = getSchedulesInput.parse(args)
    const qs = new URLSearchParams({ lower: String(lower), upper: String(upper) })
    try {
      return await callOpenApi<GetSchedulesOutput>(
        auth,
        'GET',
        `/v2/open/schedules/?${qs.toString()}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const createScheduleInput = z
  .object({
    name: z.string().min(1).describe('Display name for the schedule (non-empty).'),
    event_time: eventTimeSchema.describe(
      "Required. Tagged union by 'time_type' ('at' | 'period' | 'allday'). Unlike create_todo, schedules must always have a time.",
    ),
    event_tag_id: z
      .string()
      .optional()
      .describe('Optional tag uuid to categorize this schedule.'),
    repeating: repeatingSchema.optional().describe('Optional recurrence rule.'),
    notification_options: z
      .array(z.unknown())
      .optional()
      .describe('Optional notification config objects (opaque shape — see TodoCalendar app docs).'),
    show_turns: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Per-occurrence visibility map for repeating schedules (opaque key→value object). Usually omitted on creation; the server fills defaults.',
      ),
  })
  .describe(
    'Body for creating a new schedule. The owner is taken from the auth context — never pass userId here.',
  )

type CreateScheduleInput = z.infer<typeof createScheduleInput>

const createScheduleOutput = scheduleSchema

type CreateScheduleOutput = z.infer<typeof createScheduleOutput>

export const createSchedule: ToolDefinition<CreateScheduleInput, CreateScheduleOutput> = {
  name: 'create_schedule',
  description: `\
Create a new schedule (calendar event) for the authenticated user. Returns the created schedule with its assigned uuid.

Unlike todos, schedules require an 'event_time'. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: createScheduleInput,
  outputSchema: createScheduleOutput,
  execute: async (auth: Auth, args: unknown): Promise<CreateScheduleOutput> => {
    const body = createScheduleInput.parse(args)
    try {
      return await callOpenApi<CreateScheduleOutput>(auth, 'POST', '/v2/open/schedules/', body)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
