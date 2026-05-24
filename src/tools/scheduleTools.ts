import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { buildConfirmRequired, ensureConfirmToken } from './shared/confirm.js'
import {
  confirmableStatusSchema,
  eventTimeInputSchema,
  isoToTsField,
  repeatingInputSchema,
  scheduleSchema,
} from './shared/schemas.js'
import { augmentIso } from './shared/time.js'
import type { ToolDefinition } from './shared/tool.js'

const getSchedulesInput = z
  .object({
    lower: isoToTsField.describe('Range start (inclusive). ISO 8601 datetime with offset.'),
    upper: isoToTsField.describe('Range end (inclusive). ISO 8601 datetime with offset.'),
  })
  .describe('Both lower and upper are required (no current/uncompleted modes for schedules).')

type GetSchedulesInput = z.infer<typeof getSchedulesInput>

const getSchedulesOutput = z
  .array(scheduleSchema)
  .describe('List of schedules whose event_time overlaps the requested range.')

type GetSchedulesOutput = z.infer<typeof getSchedulesOutput>

export const getSchedules: ToolDefinition<GetSchedulesInput, GetSchedulesOutput> = {
  name: 'get_schedules',
  scopes: ['read:calendar'],
  description: `\
List / fetch / show / get schedules (calendar events / appointments / meetings / time-blocked items) for the authenticated user that overlap a time range [lower, upper] (Unix epoch seconds, UTC) — use for "what's on my calendar today / this week / on date X".

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). 'exclude_repeatings' lists occurrence start timestamps that have been removed from the recurrence.`,
  inputSchema: getSchedulesInput,
  outputSchema: getSchedulesOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetSchedulesOutput> => {
    const { lower, upper } = getSchedulesInput.parse(args)
    const qs = new URLSearchParams({ lower: String(lower), upper: String(upper) })
    try {
      return augmentIso(
        await callOpenApi<GetSchedulesOutput>(auth, 'GET', `/v2/open/schedules/?${qs.toString()}`),
      ) as GetSchedulesOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const scheduleInputSchema = z
  .object({
    name: z.string().min(1).describe('Display name for the schedule (non-empty).'),
    event_time: eventTimeInputSchema.describe(
      "Required. Tagged union by 'time_type' ('at' | 'period' | 'allday'). Unlike todos, schedules must always have a time.",
    ),
    event_tag_id: z
      .string()
      .optional()
      .describe('Optional tag uuid to categorize this schedule.'),
    repeating: repeatingInputSchema.optional().describe('Optional recurrence rule.'),
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
    'Schedule creation payload (used by create_schedule and the `new` field of replace_schedule_occurrence / branch_schedule_repeating). The owner is taken from the auth context — never pass userId here.',
  )

const createScheduleInput = scheduleInputSchema

type CreateScheduleInput = z.infer<typeof createScheduleInput>

const createScheduleOutput = scheduleSchema

type CreateScheduleOutput = z.infer<typeof createScheduleOutput>

export const createSchedule: ToolDefinition<CreateScheduleInput, CreateScheduleOutput> = {
  name: 'create_schedule',
  scopes: ['write:calendar'],
  description: `\
Create a new schedule (calendar event) for the authenticated user. Returns the created schedule with its assigned uuid.

Unlike todos, schedules require an 'event_time'. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: createScheduleInput,
  outputSchema: createScheduleOutput,
  execute: async (auth: Auth, args: unknown): Promise<CreateScheduleOutput> => {
    const body = createScheduleInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<CreateScheduleOutput>(auth, 'POST', '/v2/open/schedules/', body),
      ) as CreateScheduleOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const updateScheduleInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the schedule to update.'),
    name: z.string().optional().describe('New display name. Omit to keep unchanged.'),
    event_time: eventTimeInputSchema
      .optional()
      .describe('Replacement event_time. Omit to keep unchanged.'),
    event_tag_id: z
      .string()
      .optional()
      .describe('Tag uuid to reassign this schedule to. Omit to keep unchanged.'),
    repeating: repeatingInputSchema
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
  scopes: ['write:calendar'],
  description: `\
Partially update a schedule's fields (PATCH). Returns the full updated schedule.

Only the fields you include in the body are applied — omitted fields stay as-is. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: updateScheduleInput,
  outputSchema: updateScheduleOutput,
  execute: async (auth: Auth, args: unknown): Promise<UpdateScheduleOutput> => {
    const { schedule_id, ...body } = updateScheduleInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<UpdateScheduleOutput>(
          auth,
          'PATCH',
          `/v2/open/schedules/${encodeURIComponent(schedule_id)}`,
          body,
        ),
      ) as UpdateScheduleOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const excludeScheduleOccurrenceInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the repeating schedule.'),
    exclude_repeatings: isoToTsField.describe(
      "ISO 8601 datetime of the single occurrence to exclude. Must be one of the origin's repeating occurrence start times.",
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
  scopes: ['write:calendar'],
  description: `\
Skip a single occurrence of a repeating schedule, leaving the rest of the recurrence intact. Returns the updated origin schedule (with the timestamp added to its 'exclude_repeatings').

Decision guide for the agent:
  - Use this when the user wants to cancel/skip just one occurrence and keep the recurrence as-is.
  - To replace that occurrence with a one-off schedule (different fields), use replace_schedule_occurrence instead.
  - To switch the recurrence rule itself from a certain point forward (e.g. daily → weekly starting next Monday), use branch_schedule_repeating.

All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: excludeScheduleOccurrenceInput,
  outputSchema: excludeScheduleOccurrenceOutput,
  execute: async (
    auth: Auth,
    args: unknown,
  ): Promise<ExcludeScheduleOccurrenceOutput> => {
    const { schedule_id, ...body } = excludeScheduleOccurrenceInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<ExcludeScheduleOccurrenceOutput>(
          auth,
          'PATCH',
          `/v2/open/schedules/${encodeURIComponent(schedule_id)}/exclude`,
          body,
        ),
      ) as ExcludeScheduleOccurrenceOutput
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
    exclude_repeatings: isoToTsField.describe(
      "ISO 8601 datetime of the occurrence to exclude on the origin. The origin's repeating continues, this single slot is excluded.",
    ),
  })
  .describe(
    'Body for replacing a single occurrence: creates a new schedule AND excludes that occurrence from the origin in one transaction.',
  )

type ReplaceScheduleOccurrenceInput = z.infer<typeof replaceScheduleOccurrenceInput>

export const replaceScheduleOccurrenceOutput = z
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
  scopes: ['write:calendar'],
  description: `\
Replace a single occurrence of a repeating schedule with a one-off schedule. The origin's recurrence continues for all other occurrences; only this slot is replaced. Returns both the updated origin and the new schedule.

Decision guide for the agent:
  - Use this when the user wants to *replace* one occurrence (different name/time/details) while keeping the rest of the recurrence.
  - To merely cancel/skip an occurrence without a replacement, use exclude_schedule_occurrence.
  - To switch the recurrence rule itself from a certain point forward (e.g. daily → weekly starting next Monday), use branch_schedule_repeating.

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: replaceScheduleOccurrenceInput,
  outputSchema: replaceScheduleOccurrenceOutput,
  execute: async (
    auth: Auth,
    args: unknown,
  ): Promise<ReplaceScheduleOccurrenceOutput> => {
    const { schedule_id, ...body } = replaceScheduleOccurrenceInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<ReplaceScheduleOccurrenceOutput>(
          auth,
          'POST',
          `/v2/open/schedules/${encodeURIComponent(schedule_id)}/exclude`,
          body,
        ),
      ) as ReplaceScheduleOccurrenceOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const branchScheduleRepeatingInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the origin (repeating) schedule.'),
    new: scheduleInputSchema.describe(
      'New schedule that continues from the branch point. Typically a repeating schedule whose `repeating.start` equals the branch point.',
    ),
    end_time: isoToTsField.describe(
      "ISO 8601 datetime at which the origin's recurrence ends and the new schedule takes over.",
    ),
  })
  .describe(
    "Body for branching: caps the origin's recurrence at `end_time` and starts a new schedule for the remainder.",
  )

type BranchScheduleRepeatingInput = z.infer<typeof branchScheduleRepeatingInput>

export const branchScheduleRepeatingOutput = z
  .object({
    new: scheduleSchema.describe('The new schedule that takes over from the branch point.'),
    origin: scheduleSchema.describe(
      "The origin schedule with its recurrence ended at `end_time`.",
    ),
  })
  .describe('Result of branch_schedule_repeating.')

type BranchScheduleRepeatingOutput = z.infer<typeof branchScheduleRepeatingOutput>

export const branchScheduleRepeating: ToolDefinition<
  BranchScheduleRepeatingInput,
  BranchScheduleRepeatingOutput
> = {
  name: 'branch_schedule_repeating',
  scopes: ['write:calendar'],
  description: `\
Cut a repeating schedule at a point in time and start a new schedule from there. Past occurrences stay on the origin; from \`end_time\` the new schedule takes over. Response has 'new' (the branch schedule) and 'origin' (the capped origin).

Decision guide for the agent:
  - Use this when the recurrence definition itself changes from a certain point forward (e.g. user says "from next Monday, switch to weekly Tue/Thu instead of daily").
  - update_schedule modifies the recurrence rule globally (affects past occurrences too, because the rule is recomputed from start). Use this branch tool when the rule change should apply only from a point onward and past occurrences must be preserved.
  - To replace only one occurrence while keeping the recurrence, use replace_schedule_occurrence.
  - To skip one occurrence with no replacement, use exclude_schedule_occurrence.

All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: branchScheduleRepeatingInput,
  outputSchema: branchScheduleRepeatingOutput,
  execute: async (
    auth: Auth,
    args: unknown,
  ): Promise<BranchScheduleRepeatingOutput> => {
    const { schedule_id, ...body } = branchScheduleRepeatingInput.parse(args)
    try {
      return augmentIso(
        await callOpenApi<BranchScheduleRepeatingOutput>(
          auth,
          'POST',
          `/v2/open/schedules/${encodeURIComponent(schedule_id)}/branch_repeating`,
          body,
        ),
      ) as BranchScheduleRepeatingOutput
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const deleteScheduleInput = z
  .object({
    schedule_id: z.string().min(1).describe('UUID of the schedule to delete.'),
    confirmToken: z
      .string()
      .optional()
      .describe(
        'Echo back the token returned by the first call to actually execute the deletion. Omit on the first call to receive a confirmToken.',
      ),
  })
  .describe(
    'Delete a schedule. This is a CONFIRM-gated tool — see the tool description for the two-step flow.',
  )

type DeleteScheduleInput = z.infer<typeof deleteScheduleInput>

const deleteScheduleOutput = confirmableStatusSchema.describe(
  'CONFIRM-gated tool result. First call: { status:"confirm_required", message, confirmToken, action, target } — no backend mutation. Second call (with confirmToken): { status:"ok" } after actual deletion. Note: the openAPI returns HTTP 201 (not 200) for schedule delete — the payload shape is still {status:"ok"}. Any additional fields the openAPI returns are preserved verbatim (raw passthrough).',
)

type DeleteScheduleOutput = z.infer<typeof deleteScheduleOutput>

export const deleteSchedule: ToolDefinition<DeleteScheduleInput, DeleteScheduleOutput> = {
  name: 'delete_schedule',
  scopes: ['write:calendar'],
  description: `\
Permanently delete a schedule (including all of its repeating occurrences if any). CONFIRM-gated: the first call does NOT delete — it returns a confirmToken that must be echoed back to actually execute.

Two-step flow:
  1. Call with { schedule_id }. Response is { status: 'confirm_required', message, confirmToken, action, target }. No backend mutation has happened.
  2. Surface 'message' to the end user. If they approve, re-call with { schedule_id, confirmToken } using the SAME schedule_id. The token expires in 5 minutes and is bound to this user + tool + args.

Decision guide for repeating schedules (pick the smallest scope that matches the user's intent):
  - Skip a single occurrence (no replacement, series continues): exclude_schedule_occurrence.
  - Replace a single occurrence with a one-off (series continues): replace_schedule_occurrence.
  - Switch the recurrence rule itself from a certain point forward (e.g. daily → weekly starting next Monday): branch_schedule_repeating.
  - Remove the entire series outright: this tool (delete_schedule).`,
  inputSchema: deleteScheduleInput,
  outputSchema: deleteScheduleOutput,
  execute: async (auth: Auth, args: unknown): Promise<DeleteScheduleOutput> => {
    const parsed = deleteScheduleInput.parse(args)
    const target = { schedule_id: parsed.schedule_id }

    if (parsed.confirmToken === undefined) {
      return buildConfirmRequired(
        'delete_schedule',
        target,
        auth.userId,
        `This will permanently delete schedule '${parsed.schedule_id}' and all of its occurrences. Re-call delete_schedule with the same arguments plus the returned confirmToken to proceed. The token expires in 5 minutes.`,
      )
    }

    ensureConfirmToken(parsed.confirmToken, 'delete_schedule', target, auth.userId)

    try {
      return await callOpenApi<DeleteScheduleOutput>(
        auth,
        'DELETE',
        `/v2/open/schedules/${encodeURIComponent(parsed.schedule_id)}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
