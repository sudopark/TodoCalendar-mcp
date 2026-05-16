import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { completeTodo, createTodo } from '../../src/tools/todoTools.js'
import {
  deleteDoneTodo,
  getDoneTodos,
  getDoneTodosOutput,
  revertDoneTodo,
  revertDoneTodoOutput,
  updateDoneTodo,
} from '../../src/tools/doneTodoTools.js'
import type { doneTodoSchema, todoSchema } from '../../src/tools/shared/schemas.js'
import type { Auth } from '../../src/auth/types.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('doneTodo', readiness)

type Todo = z.infer<typeof todoSchema>
type DoneTodo = z.infer<typeof doneTodoSchema>
type GetDoneTodosResult = z.infer<typeof getDoneTodosOutput>
type RevertDoneTodoResult = z.infer<typeof revertDoneTodoOutput>

// done-todo는 active todo를 complete해서 만든다. 각 it의 fixture로 한 줄 헬퍼.
// 의존: createTodo / completeTodo — 이 둘 중 하나가 회귀하면 doneTodo it 전체가 cascade fail.
// 의식적 trade-off (swagger 면을 우회하는 raw firestore write 대신 정규 호출).
const seedDoneTodo = async (auth: Auth, name: string): Promise<DoneTodo> => {
  const created = (await createTodo.execute(auth, { name })) as Todo
  const completed = (await completeTodo.execute(auth, {
    todo_id: created.uuid,
    origin: created,
  })) as { done: DoneTodo }
  return completed.done
}

describe.skipIf(!readiness.ready)('integration: done-todo happy path', () => {
  it('get_done_todos — 시드 done이 페이지 array에 포함', async () => {
    const auth = makeIntegrationAuth()
    await seedDoneTodo(auth, 'in-page')

    const page = (await getDoneTodos.execute(auth, { size: 10 })) as GetDoneTodosResult
    expect(page.some((d) => d.name === 'in-page')).toBe(true)
  })

  it('update_done_todo — name 갱신', async () => {
    const auth = makeIntegrationAuth()
    const done = await seedDoneTodo(auth, 'before-update')

    const updated = (await updateDoneTodo.execute(auth, {
      done_todo_id: done.uuid,
      name: 'after-update',
    })) as DoneTodo
    expect(updated.uuid).toBe(done.uuid)
    expect(updated.name).toBe('after-update')
  })

  it('revert_done_todo — done을 active todo로 복귀 (auth user 면 round-trip)', async () => {
    const auth = makeIntegrationAuth()
    const done = await seedDoneTodo(auth, 'to-revert')

    const result = (await revertDoneTodo.execute(auth, {
      done_todo_id: done.uuid,
    })) as RevertDoneTodoResult
    expect(typeof result.todo.uuid).toBe('string')
    expect(result.todo.userId).toBe(auth.userId)
  })

  it('delete_done_todo — status:ok 반환', async () => {
    const auth = makeIntegrationAuth()
    const done = await seedDoneTodo(auth, 'to-delete')

    const result = (await deleteDoneTodo.execute(auth, {
      done_todo_id: done.uuid,
    })) as { status: string }
    expect(result.status).toBe('ok')
  })
})
