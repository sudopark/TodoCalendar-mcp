import { deleteDoneTodo, getDoneTodos, revertDoneTodo, updateDoneTodo } from './doneTodoTools.js'
import { deleteEventDetail, getEventDetails, setEventDetail } from './eventDetailTools.js'
import {
  branchScheduleRepeating,
  createSchedule,
  excludeScheduleOccurrence,
  getSchedules,
  replaceScheduleOccurrence,
  updateSchedule,
} from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { createTag, deleteTag, getTags, updateTag } from './tagTools.js'
import { completeTodo, createTodo, getTodos, replaceTodo, updateTodo } from './todoTools.js'

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
  branchScheduleRepeating as AnyToolDefinition,
  completeTodo as AnyToolDefinition,
  createSchedule as AnyToolDefinition,
  createTag as AnyToolDefinition,
  createTodo as AnyToolDefinition,
  deleteDoneTodo as AnyToolDefinition,
  deleteEventDetail as AnyToolDefinition,
  deleteTag as AnyToolDefinition,
  excludeScheduleOccurrence as AnyToolDefinition,
  getDoneTodos as AnyToolDefinition,
  getEventDetails as AnyToolDefinition,
  getSchedules as AnyToolDefinition,
  getTags as AnyToolDefinition,
  getTodos as AnyToolDefinition,
  replaceScheduleOccurrence as AnyToolDefinition,
  replaceTodo as AnyToolDefinition,
  revertDoneTodo as AnyToolDefinition,
  setEventDetail as AnyToolDefinition,
  updateDoneTodo as AnyToolDefinition,
  updateSchedule as AnyToolDefinition,
  updateTag as AnyToolDefinition,
  updateTodo as AnyToolDefinition,
])

export {
  branchScheduleRepeating,
  completeTodo,
  createSchedule,
  createTag,
  createTodo,
  deleteDoneTodo,
  deleteEventDetail,
  deleteTag,
  excludeScheduleOccurrence,
  getDoneTodos,
  getEventDetails,
  getSchedules,
  getTags,
  getTodos,
  replaceScheduleOccurrence,
  replaceTodo,
  revertDoneTodo,
  setEventDetail,
  updateDoneTodo,
  updateSchedule,
  updateTag,
  updateTodo,
}
