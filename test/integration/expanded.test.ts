import { describe, expect, it } from 'vitest'
import { createSchedule, getExpandedSchedules } from '../../src/tools/scheduleTools.js'
import { createTodo, getExpandedTodos } from '../../src/tools/todoTools.js'
import { ToolError } from '../../src/tools/shared/errors.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('expanded', readiness)

// T1 = 2023-11-14T22:13:20Z (Unix 1_700_000_000). daily 룰의 occurrence: T1, T1+1d, ...
const T1_ISO = '2023-11-14T22:13:20Z'
const atTime = (iso: string) => ({ time_type: 'at' as const, timestamp: iso })
const dailyFrom = (iso: string) => ({
  start: iso,
  option: { optionType: 'every_day' as const, interval: 1 },
})

interface Occurrence {
  origin_event_id: string
  turn: number
  event_time: { time_type: string; timestamp: number }
}
interface ExpandedResult {
  events: Record<string, { uuid: string; name: string }>
  occurrences: Occurrence[]
  next_cursor: string | null
}

describe.skipIf(!readiness.ready)('integration: expanded occurrence 조회', () => {
  it('get_expanded_schedules — daily 반복이 window 안에서 turn별로 전개', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'daily-meeting',
      event_time: atTime(T1_ISO),
      repeating: dailyFrom(T1_ISO),
    })) as { uuid: string }

    // T1 .. T1+7d
    const result = (await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-21T00:00:00Z',
    })) as unknown as ExpandedResult

    const mine = result.occurrences.filter((o) => o.origin_event_id === origin.uuid)
    expect(mine.length).toBeGreaterThanOrEqual(6)
    // turn은 1-based 증가, origin 메타는 events에 1벌
    expect(mine.map((o) => o.turn)).toEqual(expect.arrayContaining([1, 2, 3]))
    expect(result.events[origin.uuid]?.name).toBe('daily-meeting')
    // occurrence event_time에 *_iso 형제 필드
    expect((mine[0]?.event_time as Record<string, unknown>).timestamp_iso).toBeTypeOf('string')
  })

  it('get_expanded_todos — 반복 todo 전개', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createTodo.execute(auth, {
      name: 'daily-task',
      event_time: atTime(T1_ISO),
      repeating: dailyFrom(T1_ISO),
    })) as { uuid: string }

    const result = (await getExpandedTodos.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-18T00:00:00Z',
    })) as unknown as ExpandedResult

    const mine = result.occurrences.filter((o) => o.origin_event_id === origin.uuid)
    expect(mine.length).toBeGreaterThanOrEqual(3)
    expect(result.events[origin.uuid]?.name).toBe('daily-task')
  })

  it('window 1년 초과 → InvalidParameter (ToolError 400)', async () => {
    const auth = makeIntegrationAuth()
    await expect(
      getExpandedSchedules.execute(auth, {
        lower: '2023-01-01T00:00:00Z',
        upper: '2025-01-01T00:00:00Z', // 2년
      }),
    ).rejects.toThrow(ToolError)
  })

  it('cursor 페이징 — limit으로 쪼개 받아도 occurrence 비중복', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'daily-paged',
      event_time: atTime(T1_ISO),
      repeating: dailyFrom(T1_ISO),
    })) as { uuid: string }

    const page1 = (await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-21T00:00:00Z',
      limit: 3,
    })) as unknown as ExpandedResult
    expect(page1.occurrences.length).toBe(3)
    expect(page1.next_cursor).toBeTypeOf('string')

    const page2 = (await getExpandedSchedules.execute(auth, {
      lower: '2023-11-14T00:00:00Z',
      upper: '2023-11-21T00:00:00Z',
      limit: 3,
      cursor: page1.next_cursor as string,
    })) as unknown as ExpandedResult

    const key = (o: Occurrence) => `${o.origin_event_id}:${o.turn}`
    const p1Keys = new Set(page1.occurrences.map(key))
    const overlap = page2.occurrences.filter((o) => p1Keys.has(key(o)))
    expect(overlap).toEqual([])
    // origin이 양 페이지에 걸쳐 있음을 확인 (sanity)
    expect(
      page1.occurrences.concat(page2.occurrences).some((o) => o.origin_event_id === origin.uuid),
    ).toBe(true)
  })
})
