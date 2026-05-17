import { z } from 'zod'
import type { Auth } from '../auth/types.js'
import { callOpenApi } from '../openapi/client.js'
import { naturalizeToolMessage, ToolError, wrapOpenApiError } from './shared/errors.js'
import { buildConfirmRequired, ensureConfirmToken } from './shared/confirm.js'
import {
  confirmableStatusSchema,
  doneTodoSchema,
  eventDetailSchema,
  eventTimeSchema,
  repeatingSchema,
  todoSchema,
} from './shared/schemas.js'
import type { ToolDefinition } from './shared/tool.js'

const TS_SEC = 'Unix epoch seconds (UTC).'

// 평탄화된 단일 object — discriminatedUnion은 root oneOf을 만들어 Anthropic API
// (tools[*].input_schema)에서 400. 분기별 필수 필드 검증은 dispatchPath에서 mode로 분기해 ToolError.
const getTodosInput = z
  .object({
    mode: z
      .enum(['current', 'range', 'uncompleted'])
      .describe(
        'Selection mode. "current": non-time-bound todos (no other field required). "range": todos within [lower, upper] (both lower & upper required). "uncompleted": todos still uncompleted as of refTime (refTime required).',
      ),
    lower: z
      .number()
      .optional()
      .describe(`Required when mode="range". Range start (inclusive). ${TS_SEC}`),
    upper: z
      .number()
      .optional()
      .describe(`Required when mode="range". Range end (inclusive). ${TS_SEC}`),
    refTime: z
      .number()
      .optional()
      .describe(
        `Required when mode="uncompleted". Reference moment to compute "still uncompleted" against. ${TS_SEC}`,
      ),
  })
  .describe('Pick a mode then provide the fields it requires (see field descriptions).')

type GetTodosInput = z.infer<typeof getTodosInput>

const getTodosOutput = z
  .array(todoSchema)
  .describe('List of todos. All timestamps are Unix epoch seconds (UTC).')

type GetTodosOutput = z.infer<typeof getTodosOutput>

const missingFieldError = (detail: string): ToolError =>
  new ToolError(400, 'InvalidParameter', naturalizeToolMessage('InvalidParameter', detail))

const dispatchPath = (input: GetTodosInput): string => {
  switch (input.mode) {
    case 'current':
      return '/v2/open/todos/'
    case 'range': {
      if (input.lower === undefined || input.upper === undefined) {
        throw missingFieldError('mode="range" requires both `lower` and `upper`')
      }
      const qs = new URLSearchParams({
        lower: String(input.lower),
        upper: String(input.upper),
      })
      return `/v2/open/todos/?${qs.toString()}`
    }
    case 'uncompleted': {
      if (input.refTime === undefined) {
        throw missingFieldError('mode="uncompleted" requires `refTime`')
      }
      const qs = new URLSearchParams({ refTime: String(input.refTime) })
      return `/v2/open/todos/uncompleted?${qs.toString()}`
    }
  }
}

export const getTodos: ToolDefinition<GetTodosInput, GetTodosOutput> = {
  name: 'get_todos',
  scopes: ['read:calendar'],
  description: `\
List / fetch / show / retrieve / get todos (tasks, action items) for the authenticated user — supports pending, overdue, today, upcoming, and always-visible workflows via 'mode'.

Three modes (specify exactly one via 'mode'):
  - 'current': always-visible / sticky / pending / non-time-bound todos that stay listed until completed
  - 'range': todos whose event_time falls within [lower, upper] (Unix epoch seconds, UTC) — use for "todos today / this week / on date X"
  - 'uncompleted': overdue / past-due / still-open todos as of refTime (Unix epoch seconds, UTC) — use for "what's left to do as of a specific moment"

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

const todoInputSchema = z
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
    'Todo creation payload (used by create_todo and replace_todo `new`). The owner is taken from the auth context — never pass userId here.',
  )

const createTodoInput = todoInputSchema

type CreateTodoInput = z.infer<typeof createTodoInput>

const createTodoOutput = todoSchema

type CreateTodoOutput = z.infer<typeof createTodoOutput>

export const createTodo: ToolDefinition<CreateTodoInput, CreateTodoOutput> = {
  name: 'create_todo',
  scopes: ['write:calendar'],
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

export const updateTodo: ToolDefinition<UpdateTodoInput, UpdateTodoOutput> = {
  name: 'update_todo',
  scopes: ['write:calendar'],
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
  scopes: ['write:calendar'],
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

const replaceTodoInput = z
  .object({
    todo_id: z.string().min(1).describe('UUID of the origin (repeating) todo to replace.'),
    new: todoInputSchema.describe(
      'Replacement todo payload (creates a new todo). Same shape as create_todo body.',
    ),
    origin_next_event_time: eventTimeSchema
      .optional()
      .describe(
        "Optional. If the origin is repeating and should continue past this replacement, supply the EventTime of the origin's next occurrence — the origin is updated to that time. Omit to delete the origin entirely after replacement.",
      ),
  })
  .describe(
    "Body for replacing a repeating todo. Creates a 'new' todo and either advances the origin to 'origin_next_event_time' (if provided) or deletes it.",
  )

type ReplaceTodoInput = z.infer<typeof replaceTodoInput>

const replaceTodoOutput = z
  .object({
    new_todo: todoSchema.describe('The newly created replacement todo.'),
    next_repeating: todoSchema
      .nullish()
      .describe(
        'The origin todo advanced to its next occurrence, when origin_next_event_time was supplied. Null/absent when the origin was deleted.',
      ),
  })
  .describe('Result of replace_todo.')

type ReplaceTodoOutput = z.infer<typeof replaceTodoOutput>

export const replaceTodo: ToolDefinition<ReplaceTodoInput, ReplaceTodoOutput> = {
  name: 'replace_todo',
  scopes: ['write:calendar'],
  description: `\
Replace a repeating todo with a new one, choosing how the origin is treated. Only meaningful for *repeating* todos — for non-repeating todos this would just delete+create and you should use update_todo (PATCH) instead.

Decision guide for the agent:
  - To replace a single occurrence of a repeating todo (other occurrences continue): set 'origin_next_event_time' to the next event_time of the origin so the origin advances past this turn.
  - To replace the entire repeating series (no more occurrences from origin): omit 'origin_next_event_time' — the origin is deleted after the new todo is created.

The 'event_time' field is a tagged union by 'time_type' ('at' | 'period' | 'allday'). All timestamps are Unix epoch seconds (UTC).`,
  inputSchema: replaceTodoInput,
  outputSchema: replaceTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<ReplaceTodoOutput> => {
    const { todo_id, ...body } = replaceTodoInput.parse(args)
    try {
      return await callOpenApi<ReplaceTodoOutput>(
        auth,
        'POST',
        `/v2/open/todos/${encodeURIComponent(todo_id)}/replace`,
        body,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}

const deleteTodoInput = z
  .object({
    todo_id: z.string().min(1).describe('UUID of the todo to delete.'),
    confirmToken: z
      .string()
      .optional()
      .describe(
        'Echo back the token returned by the first call to actually execute the deletion. Omit on the first call to receive a confirmToken.',
      ),
  })
  .describe(
    'Delete a todo. This is a CONFIRM-gated tool — see the tool description for the two-step flow.',
  )

type DeleteTodoInput = z.infer<typeof deleteTodoInput>

const deleteTodoOutput = confirmableStatusSchema

type DeleteTodoOutput = z.infer<typeof deleteTodoOutput>

export const deleteTodo: ToolDefinition<DeleteTodoInput, DeleteTodoOutput> = {
  name: 'delete_todo',
  scopes: ['write:calendar'],
  description: `\
Permanently delete a todo (full deletion — for non-repeating todos this just removes the record; for repeating todos this removes the ENTIRE series). CONFIRM-gated: the first call does NOT delete — it returns a confirmToken that must be echoed back to actually execute.

Two-step flow:
  1. Call with { todo_id }. Response is { status: 'confirm_required', message, confirmToken, action, target }. No backend mutation has happened.
  2. Surface 'message' to the end user. If they approve, re-call with { todo_id, confirmToken } using the SAME todo_id. The token expires in 5 minutes and is bound to this user + tool + args — passing it to a different tool, args, or user is rejected.

Decision guide vs. other tools for repeating todos (openAPI has NO skip-one-turn endpoint for todos):
  - To replace a single occurrence (origin advances to the next turn, current turn becomes a different todo): use replace_todo with origin_next_event_time.
  - To skip a single occurrence without replacing it (no equivalent of exclude_schedule_occurrence): use replace_todo with origin_next_event_time set to the turn AFTER the one being skipped, with the 'new' todo describing a no-op (e.g. completed/cancelled state) — there is no direct skip-only endpoint.
  - To remove the entire series: this tool (delete_todo).`,
  inputSchema: deleteTodoInput,
  outputSchema: deleteTodoOutput,
  execute: async (auth: Auth, args: unknown): Promise<DeleteTodoOutput> => {
    const parsed = deleteTodoInput.parse(args)
    const target = { todo_id: parsed.todo_id }

    if (parsed.confirmToken === undefined) {
      return buildConfirmRequired(
        'delete_todo',
        target,
        auth.userId,
        `This will permanently delete todo '${parsed.todo_id}'. Re-call delete_todo with the same arguments plus the returned confirmToken to proceed. The token expires in 5 minutes.`,
      )
    }

    ensureConfirmToken(parsed.confirmToken, 'delete_todo', target, auth.userId)

    try {
      return await callOpenApi<DeleteTodoOutput>(
        auth,
        'DELETE',
        `/v2/open/todos/${encodeURIComponent(parsed.todo_id)}`,
      )
    } catch (e) {
      return wrapOpenApiError(e)
    }
  },
}
