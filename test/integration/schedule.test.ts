import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  branchScheduleRepeating,
  createSchedule,
  deleteSchedule,
  excludeScheduleOccurrence,
  getSchedules,
  replaceScheduleOccurrence,
  updateSchedule,
} from '../../src/tools/scheduleTools.js'
import type { scheduleSchema } from '../../src/tools/shared/schemas.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('schedule', readiness)

// [리뷰 #30 옵션 2번] inline 5필드 cast 대신 schema 면에 묶음 — schema 확장 시 자동 추종.
type Schedule = z.infer<typeof scheduleSchema>

// schedule은 todo와 달리 event_time 필수. 기본 시간 fixture 헬퍼.
const T1 = 1_700_000_000
const T2 = 1_700_003_600
const atTime = (timestamp: number) =>
  ({ time_type: 'at' as const, timestamp }) as const
const dailyFrom = (start: number) =>
  ({ start, option: { optionType: 'every_day', interval: 1 } }) as const

describe.skipIf(!readiness.ready)('integration: schedule happy path', () => {
  it('create_schedule — 새 schedule 생성 후 uuid·userId 반환', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createSchedule.execute(auth, {
      name: 'integration-create',
      event_time: atTime(T1),
    })) as Schedule
    expect(created).toMatchObject({ userId: auth.userId, name: 'integration-create' })
    expect(typeof created.uuid).toBe('string')
  })

  it('get_schedules — 시드 schedule이 [lower, upper] 범위에 포함', async () => {
    const auth = makeIntegrationAuth()
    await createSchedule.execute(auth, { name: 'in-range', event_time: atTime(T1) })

    const list = (await getSchedules.execute(auth, {
      lower: T1 - 1000,
      upper: T1 + 1000,
    })) as Schedule[]
    expect(list.some((s) => s.name === 'in-range')).toBe(true)
  })

  it('update_schedule — name 갱신', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createSchedule.execute(auth, {
      name: 'before',
      event_time: atTime(T1),
    })) as Schedule

    const updated = (await updateSchedule.execute(auth, {
      schedule_id: created.uuid,
      name: 'after',
    })) as Schedule
    expect(updated.uuid).toBe(created.uuid)
    expect(updated.name).toBe('after')
  })

  it('exclude_schedule_occurrence — 반복 schedule의 1개 occurrence skip', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'repeating-origin',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await excludeScheduleOccurrence.execute(auth, {
      schedule_id: origin.uuid,
      exclude_repeatings: T2,
    })) as Schedule
    expect(result.uuid).toBe(origin.uuid)
    expect(result.exclude_repeatings).toEqual(expect.arrayContaining([T2]))
  })

  it('replace_schedule_occurrence — 1개 occurrence를 one-off로 교체', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'repeating-origin',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await replaceScheduleOccurrence.execute(auth, {
      schedule_id: origin.uuid,
      new: { name: 'one-off-replacement', event_time: atTime(T2) },
      exclude_repeatings: T2,
    })) as { updated_origin: Schedule; new_schedule: Schedule }
    expect(result.updated_origin.uuid).toBe(origin.uuid)
    expect(result.updated_origin.exclude_repeatings).toEqual(expect.arrayContaining([T2]))
    expect(result.new_schedule.name).toBe('one-off-replacement')
  })

  // branch_schedule_repeating은 openAPI 측에서 현재 500 반환 (TodoCalendar-Functions#178).
  // 업스트림 fix 머지 후 it.skip 제거 + happy path 검증 enable.
  it.skip('branch_schedule_repeating — Functions#178 머지 후 enable', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'origin-daily',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await branchScheduleRepeating.execute(auth, {
      schedule_id: origin.uuid,
      new: { name: 'branch-weekly', event_time: atTime(T2) },
      end_time: T2,
    })) as { new: Schedule; origin: Schedule }
    expect(result.new.name).toBe('branch-weekly')
    expect(result.origin.uuid).toBe(origin.uuid)
  })

  it('delete_schedule — CONFIRM 2단계 (첫 호출 토큰 발급, 두 번째 호출 실 삭제)', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createSchedule.execute(auth, {
      name: 'to-delete',
      event_time: atTime(T1),
    })) as Schedule

    const step1 = (await deleteSchedule.execute(auth, { schedule_id: created.uuid })) as {
      status: string
      confirmToken: string
      action: string
      target: { schedule_id: string }
    }
    expect(step1.status).toBe('confirm_required')
    expect(step1.action).toBe('delete_schedule')
    expect(step1.target).toEqual({ schedule_id: created.uuid })
    expect(typeof step1.confirmToken).toBe('string')

    const step2 = (await deleteSchedule.execute(auth, {
      schedule_id: created.uuid,
      confirmToken: step1.confirmToken,
    })) as { status: string }
    expect(step2.status).toBe('ok')
  })
})
