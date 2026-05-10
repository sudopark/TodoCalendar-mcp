import { getDoneTodos } from './doneTodoTools.js'
import { getEventDetails } from './eventDetailTools.js'
import { getSchedules } from './scheduleTools.js'
import type { AnyToolDefinition } from './shared/tool.js'
import { getTags } from './tagTools.js'
import { getTodos } from './todoTools.js'

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
])

export { getDoneTodos, getEventDetails, getSchedules, getTags, getTodos }
