import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { createTodo } from '../../src/tools/todoTools.js'
import {
  deleteEventDetail,
  getEventDetails,
  setEventDetail,
} from '../../src/tools/eventDetailTools.js'
import type { eventDetailSchema, todoSchema } from '../../src/tools/shared/schemas.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('eventDetail', readiness)

type Todo = z.infer<typeof todoSchema>
type EventDetail = z.infer<typeof eventDetailSchema>

// event_detail은 active todo / schedule / done의 uuid 위에 붙는다. active todo 시드로 통일.
// is_done=true 경로는 별 fixture가 필요하지만, set/get/delete 라우팅 자체는 동일 코드라
// is_done=false 한 경로만 검증해도 충분 (3 tool × 라우팅은 unit이 mock으로 별도 가드).

describe.skipIf(!readiness.ready)('integration: event-detail happy path', () => {
  it('set_event_detail — active todo에 place/url/memo upsert', async () => {
    const auth = makeIntegrationAuth()
    const todo = (await createTodo.execute(auth, { name: 'with-detail' })) as Todo

    const detail = (await setEventDetail.execute(auth, {
      event_id: todo.uuid,
      is_done: false,
      detail: {
        place: 'Seoul',
        url: 'https://example.com',
        memo: 'integration test',
      },
    })) as EventDetail
    expect(detail).toMatchObject({
      place: 'Seoul',
      url: 'https://example.com',
      memo: 'integration test',
    })
  })

  it('get_event_details — 시드된 detail 조회', async () => {
    const auth = makeIntegrationAuth()
    const todo = (await createTodo.execute(auth, { name: 'with-detail-get' })) as Todo
    await setEventDetail.execute(auth, {
      event_id: todo.uuid,
      is_done: false,
      detail: { place: 'Busan' },
    })

    const fetched = (await getEventDetails.execute(auth, {
      event_id: todo.uuid,
      is_done: false,
    })) as EventDetail
    expect(fetched.place).toBe('Busan')
  })

  it('delete_event_detail — status:ok 반환', async () => {
    const auth = makeIntegrationAuth()
    const todo = (await createTodo.execute(auth, { name: 'detail-to-delete' })) as Todo
    await setEventDetail.execute(auth, {
      event_id: todo.uuid,
      is_done: false,
      detail: { memo: 'will be deleted' },
    })

    const result = (await deleteEventDetail.execute(auth, {
      event_id: todo.uuid,
      is_done: false,
    })) as { status: string }
    expect(result.status).toBe('ok')
  })
})
