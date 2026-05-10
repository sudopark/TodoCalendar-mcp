import { getDoneTodos } from './doneTodoTools.js'
import { getEventDetails } from './eventDetailTools.js'
import { createSchedule, getSchedules } from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { createTag, getTags } from './tagTools.js'
import { createTodo, getTodos } from './todoTools.js'

export type { ToolDefinition, AnyToolDefinition } from './shared/tool.js'
export { ToolError } from './shared/errors.js'

const buildRegistry = (
  defs: readonly AnyToolDefinition[],
): Readonly<Record<string, AnyToolDefinition>> => {
  const map: Record<string, AnyToolDefinition> = {}
  for (const def of defs) {
    if (map[def.name] !== undefined) {
      throw new Error(`Duplicate tool name in registry: ${def.name}`)
    }
    map[def.name] = def
  }
  return Object.freeze(map)
}

export const tools = buildRegistry([
  getTodos as AnyToolDefinition,
  getSchedules as AnyToolDefinition,
  getTags as AnyToolDefinition,
  getEventDetails as AnyToolDefinition,
  getDoneTodos as AnyToolDefinition,
  createTag as AnyToolDefinition,
  createTodo as AnyToolDefinition,
  createSchedule as AnyToolDefinition,
])

export {
  createSchedule,
  createTag,
  createTodo,
  getDoneTodos,
  getEventDetails,
  getSchedules,
  getTags,
  getTodos,
}
