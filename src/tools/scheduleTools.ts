import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { scheduleSchema } from './shared/schemas.js'
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
    try {
      return await callOpenApi<GetSchedulesOutput>(
        auth,
        'GET',
        `/v2/open/schedules/?lower=${lower}&upper=${upper}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
