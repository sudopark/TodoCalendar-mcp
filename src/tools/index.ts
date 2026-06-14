import { deleteDoneTodo, getDoneTodos, revertDoneTodo, updateDoneTodo } from './doneTodoTools.js'
import { deleteEventDetail, getEventDetails, setEventDetail } from './eventDetailTools.js'
import {
  clearForemostEvent,
  getForemostEvent,
  setForemostEvent,
} from './foremostEventTools.js'
import {
  branchScheduleRepeating,
  createSchedule,
  deleteSchedule,
  excludeScheduleOccurrence,
  getExpandedSchedules,
  getSchedules,
  replaceScheduleOccurrence,
  updateSchedule,
} from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { createTag, deleteTag, getTags, updateTag } from './tagTools.js'
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getExpandedTodos,
  getTodos,
  replaceTodo,
  updateTodo,
} from './todoTools.js'

export type { ToolDefinition, AnyToolDefinition } from './shared/tool.js'
export type { Auth } from '../auth/types.js'
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
  clearForemostEvent as AnyToolDefinition,
  completeTodo as AnyToolDefinition,
  createSchedule as AnyToolDefinition,
  createTag as AnyToolDefinition,
  createTodo as AnyToolDefinition,
  deleteDoneTodo as AnyToolDefinition,
  deleteEventDetail as AnyToolDefinition,
  deleteSchedule as AnyToolDefinition,
  deleteTag as AnyToolDefinition,
  deleteTodo as AnyToolDefinition,
  excludeScheduleOccurrence as AnyToolDefinition,
  getDoneTodos as AnyToolDefinition,
  getEventDetails as AnyToolDefinition,
  getExpandedSchedules as AnyToolDefinition,
  getExpandedTodos as AnyToolDefinition,
  getForemostEvent as AnyToolDefinition,
  getSchedules as AnyToolDefinition,
  getTags as AnyToolDefinition,
  getTodos as AnyToolDefinition,
  replaceScheduleOccurrence as AnyToolDefinition,
  replaceTodo as AnyToolDefinition,
  revertDoneTodo as AnyToolDefinition,
  setEventDetail as AnyToolDefinition,
  setForemostEvent as AnyToolDefinition,
  updateDoneTodo as AnyToolDefinition,
  updateSchedule as AnyToolDefinition,
  updateTag as AnyToolDefinition,
  updateTodo as AnyToolDefinition,
])

export {
  branchScheduleRepeating,
  clearForemostEvent,
  completeTodo,
  createSchedule,
  createTag,
  createTodo,
  deleteDoneTodo,
  deleteEventDetail,
  deleteSchedule,
  deleteTag,
  deleteTodo,
  excludeScheduleOccurrence,
  getDoneTodos,
  getEventDetails,
  getExpandedSchedules,
  getExpandedTodos,
  getForemostEvent,
  getSchedules,
  getTags,
  getTodos,
  replaceScheduleOccurrence,
  replaceTodo,
  revertDoneTodo,
  setEventDetail,
  setForemostEvent,
  updateDoneTodo,
  updateSchedule,
  updateTag,
  updateTodo,
}
