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

const updateScheduleInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the schedule to update.'),
    name: z.string().optional().describe('New display name. Omit to keep unchanged.'),
    event_time: eventTimeSchema
      .optional()
      .describe('Replacement event_time. Omit to keep unchanged.'),
    event_tag_id: z
      .string()
      .optional()
      .describe('Tag uuid to reassign this schedule to. Omit to keep unchanged.'),
    repeating: repeatingSchema
      .optional()
      .describe('Replacement recurrence rule. Omit to keep unchanged.'),
    notification_options: z
      .array(z.unknown())
      .optional()
      .describe('Replacement notification config objects (opaque shape). Omit to keep unchanged.'),
    show_turns: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Replacement per-occurrence visibility map (opaque key→value object). Omit to keep unchanged.',
      ),
  })
  .describe(
    'Partial update for an existing schedule (PATCH). All body fields except schedule_id are optional — only the fields you provide are applied.',
  )

type UpdateScheduleInput = z.infer<typeof updateScheduleInput>

const updateScheduleOutput = scheduleSchema

type UpdateScheduleOutput = z.infer<typeof updateScheduleOutput>

export const updateSchedule: ToolDefinition<UpdateScheduleInput, UpdateScheduleOutput> = {
  name: 'update_schedule',
  description: `\
Partially update a schedule's fields (PATCH). Returns the full updated schedule.

Only the fields you include in the body are applied — omitted fields stay as-is. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: updateScheduleInput,
  outputSchema: updateScheduleOutput,
  execute: async (auth: Auth, args: unknown): Promise<UpdateScheduleOutput> => {
    const { schedule_id, ...body } = updateScheduleInput.parse(args)
    try {
      return await callOpenApi<UpdateScheduleOutput>(
        auth,
        'PATCH',
        `/v2/open/schedules/${encodeURIComponent(schedule_id)}`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const scheduleInputSchema = z
  .object({
    name: z.string().min(1).describe('Display name for the schedule (non-empty).'),
    event_time: eventTimeSchema.describe(
      "Required. Tagged union by 'time_type' ('at' | 'period' | 'allday').",
    ),
    event_tag_id: z.string().optional().describe('Optional tag uuid.'),
    repeating: repeatingSchema.optional().describe('Optional recurrence rule.'),
    notification_options: z
      .array(z.unknown())
      .optional()
      .describe('Optional notification config objects (opaque shape).'),
    show_turns: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional per-occurrence visibility map (opaque key→value object).'),
  })
  .describe(
    'Schedule creation payload — the owner is taken from the auth context; never pass userId.',
  )

const excludeScheduleOccurrenceInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the repeating schedule.'),
    exclude_repeatings: z
      .number()
      .describe(
        `Timestamp (${TS_SEC}) of the single occurrence to exclude. Must be one of the origin's repeating occurrence start times.`,
      ),
  })
  .describe(
    'Body for excluding one occurrence of a repeating schedule. The origin schedule is updated in place — its `exclude_repeatings` array grows by one entry.',
  )

type ExcludeScheduleOccurrenceInput = z.infer<typeof excludeScheduleOccurrenceInput>

const excludeScheduleOccurrenceOutput = scheduleSchema

type ExcludeScheduleOccurrenceOutput = z.infer<typeof excludeScheduleOccurrenceOutput>

export const excludeScheduleOccurrence: ToolDefinition<
  ExcludeScheduleOccurrenceInput,
  ExcludeScheduleOccurrenceOutput
> = {
  name: 'exclude_schedule_occurrence',
  description: `\
Skip a single occurrence of a repeating schedule, leaving the rest of the recurrence intact. Returns the updated origin schedule (with the timestamp added to its 'exclude_repeatings').

Decision guide for the agent:
  - Use this when the user wants to cancel/skip just one occurrence and keep the recurrence as-is.
  - To replace that occurrence with a one-off schedule (different fields), use replace_schedule_occurrence instead.
  - To cut the recurrence at a point and start a new series, use branch_schedule_repeating.

All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: excludeScheduleOccurrenceInput,
  outputSchema: excludeScheduleOccurrenceOutput,
  execute: async (
    auth: Auth,
    args: unknown,
  ): Promise<ExcludeScheduleOccurrenceOutput> => {
    const { schedule_id, ...body } = excludeScheduleOccurrenceInput.parse(args)
    try {
      return await callOpenApi<ExcludeScheduleOccurrenceOutput>(
        auth,
        'PATCH',
        `/v2/open/schedules/${encodeURIComponent(schedule_id)}/exclude`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const replaceScheduleOccurrenceInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the origin (repeating) schedule.'),
    new: scheduleInputSchema.describe(
      'Replacement one-off schedule payload (creates a new schedule for the skipped slot). Same shape as create_schedule body.',
    ),
    exclude_repeatings: z
      .number()
      .describe(
        `Timestamp (${TS_SEC}) of the occurrence to exclude on the origin. The origin's repeating continues, this single slot is excluded.`,
      ),
  })
  .describe(
    'Body for replacing a single occurrence: creates a new schedule AND excludes that occurrence from the origin in one transaction.',
  )

type ReplaceScheduleOccurrenceInput = z.infer<typeof replaceScheduleOccurrenceInput>

const replaceScheduleOccurrenceOutput = z
  .object({
    updated_origin: scheduleSchema.describe(
      'The origin (repeating) schedule with the excluded occurrence added to `exclude_repeatings`.',
    ),
    new_schedule: scheduleSchema.describe('The newly created one-off replacement schedule.'),
  })
  .describe('Result of replace_schedule_occurrence.')

type ReplaceScheduleOccurrenceOutput = z.infer<typeof replaceScheduleOccurrenceOutput>

export const replaceScheduleOccurrence: ToolDefinition<
  ReplaceScheduleOccurrenceInput,
  ReplaceScheduleOccurrenceOutput
> = {
  name: 'replace_schedule_occurrence',
  description: `\
Replace a single occurrence of a repeating schedule with a one-off schedule. The origin's recurrence continues for all other occurrences; only this slot is replaced. Returns both the updated origin and the new schedule.

Decision guide for the agent:
  - Use this when the user wants to *replace* one occurrence (different name/time/details) while keeping the rest of the recurrence.
  - To merely cancel/skip an occurrence without a replacement, use exclude_schedule_occurrence.
  - To cut the recurrence at a point and start a new series from there, use branch_schedule_repeating.

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: replaceScheduleOccurrenceInput,
  outputSchema: replaceScheduleOccurrenceOutput,
  execute: async (
    auth: Auth,
    args: unknown,
  ): Promise<ReplaceScheduleOccurrenceOutput> => {
    const { schedule_id, ...body } = replaceScheduleOccurrenceInput.parse(args)
    try {
      return await callOpenApi<ReplaceScheduleOccurrenceOutput>(
        auth,
        'POST',
        `/v2/open/schedules/${encodeURIComponent(schedule_id)}/exclude`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
