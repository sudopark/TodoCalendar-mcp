import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import { eventTimeSchema, repeatingSchema, todoSchema } from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const TS_SEC = 'Unix epoch seconds (UTC).'

const getTodosInput = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('current') })
    .describe('Returns "current" todos that are not bound to a specific time.'),
  z
    .object({
      mode: z.literal('range'),
      lower: z.number().describe(`Range start (inclusive). ${TS_SEC}`),
      upper: z.number().describe(`Range end (inclusive). ${TS_SEC}`),
    })
    .describe('Returns todos whose event_time falls within [lower, upper].'),
  z
    .object({
      mode: z.literal('uncompleted'),
      refTime: z
        .number()
        .describe(`Reference moment to compute "still uncompleted" against. ${TS_SEC}`),
    })
    .describe('Returns todos that remain uncompleted as of refTime.'),
])

type GetTodosInput = z.infer<typeof getTodosInput>

const getTodosOutput = z
  .array(todoSchema)
  .describe('List of todos. All timestamps are Unix epoch seconds (UTC).')

type GetTodosOutput = z.infer<typeof getTodosOutput>

const dispatchPath = (input: GetTodosInput): string => {
  switch (input.mode) {
    case 'current':
      return '/v2/open/todos/'
    case 'range': {
      const qs = new URLSearchParams({
        lower: String(input.lower),
        upper: String(input.upper),
      })
      return `/v2/open/todos/?${qs.toString()}`
    }
    case 'uncompleted': {
      const qs = new URLSearchParams({ refTime: String(input.refTime) })
      return `/v2/open/todos/uncompleted?${qs.toString()}`
    }
  }
}

export const getTodos: ToolDefinition<GetTodosInput, GetTodosOutput> = {
  name: 'get_todos',
  description: `\
Fetch todos for the authenticated user.

Three modes (specify exactly one via 'mode'):
  - 'current': non-time-bound todos that should always remain visible until completed
  - 'range': todos whose event_time falls within [lower, upper] (Unix epoch seconds, UTC)
  - 'uncompleted': todos that are still uncompleted as of refTime (Unix epoch seconds, UTC)

All timestamps in the response are Unix epoch seconds (UTC). The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants).`,
  inputSchema: getTodosInput,
  outputSchema: getTodosOutput,
  execute: async (auth: Auth, args: unknown): Promise<GetTodosOutput> => {
    const input = getTodosInput.parse(args)
    try {
      return await callOpenApi<GetTodosOutput>(auth, 'GET', dispatchPath(input))
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const createTodoInput = z
  .object({
    name: z.string().min(1).describe('Display name for the todo (non-empty).'),
    event_tag_id: z
      .string()
      .optional()
      .describe('Optional tag uuid to categorize this todo.'),
    event_time: eventTimeSchema
      .optional()
      .describe(
        "Optional schedule for the todo. Omit to create a 'current' (non-time-bound) todo that stays visible until completed.",
      ),
    repeating: repeatingSchema.optional().describe('Optional recurrence rule.'),
    notification_options: z
      .array(z.unknown())
      .optional()
      .describe('Optional notification config objects (opaque shape — see TodoCalendar app docs).'),
  })
  .describe(
    'Body for creating a new todo. The owner is taken from the auth context — never pass userId here.',
  )

type CreateTodoInput = z.infer<typeof createTodoInput>

const createTodoOutput = todoSchema

type CreateTodoOutput = z.infer<typeof createTodoOutput>

export const createTodo: ToolDefinition<CreateTodoInput, CreateTodoOutput> = {
  name: 'create_todo',
  description: `\
Create a new todo for the authenticated user. Returns the created todo with its assigned uuid.

If 'event_time' is omitted the todo is created in 'current' mode (non-time-bound, always visible until completed). The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: createTodoInput,
  outputSchema: createTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<CreateTodoOutput> => {
    const body = createTodoInput.parse(args)
    try {
      return await callOpenApi<CreateTodoOutput>(auth, 'POST', '/v2/open/todos/', body)
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
