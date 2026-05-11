import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { wrapOpenApiError } from './shared/errors.js'
import {
  doneTodoSchema,
  eventDetailSchema,
  eventTimeSchema,
  repeatingSchema,
  todoSchema,
} from './shared/schemas.js'
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

const updateTodoInput = z
  .object({
    todo_id: z.string().min(1).describe('UUID of the todo to update.'),
    name: z.string().optional().describe('New display name. Omit to keep unchanged.'),
    event_tag_id: z
      .string()
      .optional()
      .describe('Tag uuid to reassign this todo to. Omit to keep unchanged.'),
    event_time: eventTimeSchema
      .optional()
      .describe('Replacement schedule. Omit to keep unchanged.'),
    repeating: repeatingSchema
      .optional()
      .describe('Replacement recurrence rule. Omit to keep unchanged.'),
    notification_options: z
      .array(z.unknown())
      .optional()
      .describe('Replacement notification config objects (opaque shape). Omit to keep unchanged.'),
  })
  .describe(
    'Partial update for an existing todo (PATCH). All body fields except todo_id are optional — only the fields you provide are applied.',
  )

type UpdateTodoInput = z.infer<typeof updateTodoInput>

const updateTodoOutput = todoSchema

type UpdateTodoOutput = z.infer<typeof updateTodoOutput>

const completeTodoInput = z
  .object({
    todo_id: z.string().min(1).describe('UUID of the todo to complete.'),
    origin: todoSchema.describe(
      'The full origin todo object being completed. Typically the same payload returned by get_todos; pass through verbatim — the server uses it to record the completed snapshot and to handle repeating-turn bookkeeping.',
    ),
    next_event_time: eventTimeSchema
      .optional()
      .describe(
        "For repeating todos: EventTime object (tagged union by 'time_type' — 'at' | 'period' | 'allday') of the next occurrence after this completion. Omit for non-repeating todos.",
      ),
    next_repeating_turn: z
      .string()
      .optional()
      .describe('For repeating todos: identifier of the next occurrence (turn).'),
  })
  .describe(
    "Body for completing a todo. Required: 'origin' (the full todo being completed). For repeating todos, optionally include 'next_event_time' / 'next_repeating_turn' to advance the recurrence to the next occurrence.",
  )

type CompleteTodoInput = z.infer<typeof completeTodoInput>

const completeTodoOutput = z
  .object({
    done: doneTodoSchema.describe('The newly-created done todo record.'),
    next_repeating: todoSchema
      .nullish()
      .describe(
        'When the completed todo was repeating and advanced, the next-turn todo. Null/absent for non-repeating completions.',
      ),
    done_detail: eventDetailSchema
      .nullish()
      .describe('The event detail (place/url/memo) carried over to the done todo, if any.'),
  })
  .describe(
    'Result of completing a todo: the new done-todo, optionally the next repeating turn, and any carried-over detail.',
  )

type CompleteTodoOutput = z.infer<typeof completeTodoOutput>

export const completeTodo: ToolDefinition<CompleteTodoInput, CompleteTodoOutput> = {
  name: 'complete_todo',
  description: `\
Mark a todo as completed. Returns the new done-todo record. For repeating todos, optionally advance to the next occurrence by passing 'next_event_time' and 'next_repeating_turn'.

The 'origin' body field must be the full todo object (uuid, userId, name, etc.) — typically the payload returned by get_todos passed through verbatim. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: completeTodoInput,
  outputSchema: completeTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<CompleteTodoOutput> => {
    const { todo_id, ...body } = completeTodoInput.parse(args)
    try {
      return await callOpenApi<CompleteTodoOutput>(
        auth,
        'POST',
        `/v2/open/todos/${encodeURIComponent(todo_id)}/complete`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

export const updateTodo: ToolDefinition<UpdateTodoInput, UpdateTodoOutput> = {
  name: 'update_todo',
  description: `\
Partially update a todo's fields (PATCH). Returns the full updated todo.

Only the fields you include in the body are applied — omitted fields stay as-is. The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). The 'repeating.option' field is a discriminated object by 'optionType' (see field description for variants). All input timestamps are Unix epoch seconds (UTC).`,
  inputSchema: updateTodoInput,
  outputSchema: updateTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<UpdateTodoOutput> => {
    const { todo_id, ...body } = updateTodoInput.parse(args)
    try {
      return await callOpenApi<UpdateTodoOutput>(
        auth,
        'PATCH',
        `/v2/open/todos/${encodeURIComponent(todo_id)}`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
