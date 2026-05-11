import { getDoneTodos, revertDoneTodo, updateDoneTodo } from './doneTodoTools.js'
import { getEventDetails, setEventDetail } from './eventDetailTools.js'
import { createSchedule, getSchedules, updateSchedule } from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { createTag, getTags, updateTag } from './tagTools.js'
import { completeTodo, createTodo, getTodos, updateTodo } from './todoTools.js'

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
  completeTodo as AnyToolDefinition,
  createSchedule as AnyToolDefinition,
  createTag as AnyToolDefinition,
  createTodo as AnyToolDefinition,
  getDoneTodos as AnyToolDefinition,
  getEventDetails as AnyToolDefinition,
  getSchedules as AnyToolDefinition,
  getTags as AnyToolDefinition,
  getTodos as AnyToolDefinition,
  revertDoneTodo as AnyToolDefinition,
  setEventDetail as AnyToolDefinition,
  updateDoneTodo as AnyToolDefinition,
  updateSchedule as AnyToolDefinition,
  updateTag as AnyToolDefinition,
  updateTodo as AnyToolDefinition,
])

export {
  completeTodo,
  createSchedule,
  createTag,
  createTodo,
  getDoneTodos,
  getEventDetails,
  getSchedules,
  getTags,
  getTodos,
  revertDoneTodo,
  setEventDetail,
  updateDoneTodo,
  updateSchedule,
  updateTag,
  updateTodo,
}
