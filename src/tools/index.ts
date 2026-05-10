import { getDoneTodos } from './doneTodoTools.js'
import { getEventDetails } from './eventDetailTools.js'
import { getSchedules } from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { getTags } from './tagTools.js'
import { getTodos } from './todoTools.js'

export type { ToolDefinition, AnyToolDefinition } from './shared/tool.js'
export { ToolError } from './shared/errors.js'

export const tools: Readonly<Record<string, AnyToolDefinition>> = Object.freeze({
  [getTodos.name]: getTodos as AnyToolDefinition,
  [getSchedules.name]: getSchedules as AnyToolDefinition,
  [getTags.name]: getTags as AnyToolDefinition,
  [getEventDetails.name]: getEventDetails as AnyToolDefinition,
  [getDoneTodos.name]: getDoneTodos as AnyToolDefinition,
})

export { getDoneTodos, getEventDetails, getSchedules, getTags, getTodos }
