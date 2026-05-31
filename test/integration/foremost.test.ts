import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  clearForemostEvent,
  getForemostEvent,
  setForemostEvent,
} from '../../src/tools/foremostEventTools.js'
import { createSchedule } from '../../src/tools/scheduleTools.js'
import { createTodo } from '../../src/tools/todoTools.js'
import type { foremostEventSchema, scheduleSchema, todoSchema } from '../../src/tools/shared/schemas.js'
import { makeIntegrationAuth } from './_setup/auth.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'

const readiness = await checkReadiness()
warnIfSkipping('foremost', readiness)

type Todo = z.infer<typeof todoSchema>
type Schedule = z.infer<typeof scheduleSchema>
type ForemostEvent = z.infer<typeof foremostEventSchema>

describe.skipIf(!readiness.ready)('integration: foremost happy path', () => {
  it('set_foremost_event(todo) → get_foremost_event → 같은 event_id', async () => {
    const auth = makeIntegrationAuth()
    const todo = (await createTodo.execute(auth, { name: 'foremost-todo' })) as Todo

    const set = (await setForemostEvent.execute(auth, {
      event_id: todo.uuid,
      is_todo: true,
    })) as ForemostEvent
    expect(set.event_id).toBe(todo.uuid)
    expect(set.is_todo).toBe(true)

    const fetched = (await getForemostEvent.execute(auth, {})) as ForemostEvent
    expect(fetched.event_id).toBe(todo.uuid)
    expect(fetched.is_todo).toBe(true)
  })

  it('set_foremost_event(schedule) → get으로 라운드트립', async () => {
    const auth = makeIntegrationAuth()
    const schedule = (await createSchedule.execute(auth, {
      name: 'foremost-schedule',
      event_time: {
        time_type: 'at',
        timestamp: '2026-06-01T10:00:00+09:00',
      },
    })) as Schedule

    await setForemostEvent.execute(auth, { event_id: schedule.uuid, is_todo: false })

    const fetched = (await getForemostEvent.execute(auth, {})) as ForemostEvent
    expect(fetched.event_id).toBe(schedule.uuid)
    expect(fetched.is_todo).toBe(false)
  })

  it('clear_foremost_event → status:ok, 이후 get은 {} 반환', async () => {
    const auth = makeIntegrationAuth()
    const todo = (await createTodo.execute(auth, { name: 'to-be-cleared' })) as Todo
    await setForemostEvent.execute(auth, { event_id: todo.uuid, is_todo: true })

    const cleared = (await clearForemostEvent.execute(auth, {})) as { status: string }
    expect(cleared.status).toBe('ok')

    const afterClear = (await getForemostEvent.execute(auth, {})) as ForemostEvent
    expect(afterClear.event_id).toBeUndefined()
    expect(afterClear.is_todo).toBeUndefined()
  })
})
