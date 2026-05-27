import { describe, expect, it } from 'vitest'
import {
  completeTodo,
  createTodo,
  deleteTodo,
  getTodos,
  replaceTodo,
  updateTodo,
} from '../../src/tools/todoTools.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('todo', readiness)

// 각 it은 fresh auth(unique userId)로 격리. CRUD chain 깨지면 디버깅 어려우니
// 한 it 안에서 setup → 본 호출 1개를 닫는다.
describe.skipIf(!readiness.ready)('integration: todo happy path', () => {
  it('create_todo — 새 todo 생성 후 uuid·userId 반환', async () => {
    const auth = makeIntegrationAuth()
    const created = await createTodo.execute(auth, { name: 'integration-create' })
    expect(created).toMatchObject({ userId: auth.userId, name: 'integration-create' })
    expect(typeof (created as { uuid: string }).uuid).toBe('string')
  })

  it('get_todos current — 비-시간 todo 1개 생성 후 current 모드로 조회', async () => {
    const auth = makeIntegrationAuth()
    await createTodo.execute(auth, { name: 'cur-1' })

    const list = (await getTodos.execute(auth, { mode: 'current' })) as Array<{ name: string }>
    expect(list.some((t) => t.name === 'cur-1')).toBe(true)
  })

  it('update_todo — name 갱신', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTodo.execute(auth, { name: 'before' })) as { uuid: string }

    const updated = (await updateTodo.execute(auth, {
      todo_id: created.uuid,
      name: 'after',
    })) as { uuid: string; name: string }
    expect(updated.uuid).toBe(created.uuid)
    expect(updated.name).toBe('after')
  })

  it('complete_todo — 완료 처리 후 done todo 반환', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTodo.execute(auth, { name: 'to-complete' })) as {
      uuid: string
      userId: string
      name: string
      is_current: boolean
      create_timestamp: number
    }

    const result = (await completeTodo.execute(auth, {
      todo_id: created.uuid,
      origin: created,
    })) as { done: { uuid: string; name: string } }
    expect(result.done.name).toBe('to-complete')
    expect(typeof result.done.uuid).toBe('string')
  })

  it('replace_todo — 반복 origin을 새 todo로 교체 (origin 삭제)', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createTodo.execute(auth, {
      name: 'origin-repeating',
      event_time: { time_type: 'at', timestamp: '2023-11-14T22:13:20Z' },
      repeating: {
        start: '2023-11-14T22:13:20Z',
        option: { optionType: 'every_day', interval: 1 },
      },
    })) as { uuid: string }

    const result = (await replaceTodo.execute(auth, {
      todo_id: origin.uuid,
      new: { name: 'replacement' },
    })) as { new_todo: { name: string } }
    expect(result.new_todo.name).toBe('replacement')
  })

  it('delete_todo — CONFIRM 2단계 (첫 호출 토큰 발급, 두 번째 호출 실 삭제)', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTodo.execute(auth, { name: 'to-delete' })) as { uuid: string }

    // 1단계: confirmToken 발급 — openAPI hit 없음
    const step1 = (await deleteTodo.execute(auth, { todo_id: created.uuid })) as {
      status: string
      confirmToken: string
      action: string
      target: { todo_id: string }
    }
    expect(step1.status).toBe('confirm_required')
    expect(step1.action).toBe('delete_todo')
    expect(step1.target).toEqual({ todo_id: created.uuid })
    expect(typeof step1.confirmToken).toBe('string')

    // 2단계: 동일 args + confirmToken으로 재호출 — 실 삭제
    const step2 = (await deleteTodo.execute(auth, {
      todo_id: created.uuid,
      confirmToken: step1.confirmToken,
    })) as { status: string }
    expect(step2.status).toBe('ok')
  })
})
