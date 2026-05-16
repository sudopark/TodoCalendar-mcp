import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  branchScheduleRepeating,
  branchScheduleRepeatingOutput,
  createSchedule,
  deleteSchedule,
  excludeScheduleOccurrence,
  getSchedules,
  replaceScheduleOccurrence,
  replaceScheduleOccurrenceOutput,
  updateSchedule,
} from '../../src/tools/scheduleTools.js'
import type { scheduleSchema } from '../../src/tools/shared/schemas.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('schedule', readiness)

// [리뷰 #33 옵션 2번] inline 다필드 cast 대신 schema 면에 묶음 — schema 확장 시 자동 추종.
type Schedule = z.infer<typeof scheduleSchema>
type ReplaceScheduleResult = z.infer<typeof replaceScheduleOccurrenceOutput>
type BranchScheduleResult = z.infer<typeof branchScheduleRepeatingOutput>

// schedule은 todo와 달리 event_time 필수. 기본 시간 fixture.
const T1 = 1_700_000_000 // 2023-11-14T22:13:20Z (UTC) — fixture epoch
const NEXT_OCCURRENCE = T1 + 86_400 // daily 룰의 다음 occurrence start (T1+1day)
const atTime = (timestamp: number) => ({ time_type: 'at' as const, timestamp })
const dailyFrom = (start: number) => ({
  start,
  option: { optionType: 'every_day' as const, interval: 1 },
})

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

  it('exclude_schedule_occurrence — daily 룰의 occurrence 정렬 timestamp를 exclude', async () => {
    // daily 룰 occurrence: T1, T1+86400, T1+86400*2, ...
    // tool description "Must be one of the origin's repeating occurrence start times" 준수 —
    // 임의 timestamp가 아닌 실제 occurrence start로 호출해야 의미 있는 회귀.
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'repeating-origin',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await excludeScheduleOccurrence.execute(auth, {
      schedule_id: origin.uuid,
      exclude_repeatings: NEXT_OCCURRENCE,
    })) as Schedule
    expect(result.uuid).toBe(origin.uuid)
    expect(result.exclude_repeatings).toEqual(expect.arrayContaining([NEXT_OCCURRENCE]))
  })

  it('replace_schedule_occurrence — daily 룰의 occurrence 정렬 슬롯을 one-off로 교체', async () => {
    // exclude_repeatings는 origin의 occurrence start와 일치해야 하고, new.event_time도
    // 그 슬롯 자리여야 '교체' 의미가 살아남. 둘 다 NEXT_OCCURRENCE로 정렬.
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'repeating-origin',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await replaceScheduleOccurrence.execute(auth, {
      schedule_id: origin.uuid,
      new: { name: 'one-off-replacement', event_time: atTime(NEXT_OCCURRENCE) },
      exclude_repeatings: NEXT_OCCURRENCE,
    })) as ReplaceScheduleResult
    expect(result.updated_origin.uuid).toBe(origin.uuid)
    expect(result.updated_origin.exclude_repeatings).toEqual(
      expect.arrayContaining([NEXT_OCCURRENCE]),
    )
    expect(result.new_schedule.name).toBe('one-off-replacement')
  })

  it('branch_schedule_repeating — daily 룰을 NEXT_OCCURRENCE에서 끊고 새 schedule 분기', async () => {
    const auth = makeIntegrationAuth()
    const origin = (await createSchedule.execute(auth, {
      name: 'origin-daily',
      event_time: atTime(T1),
      repeating: dailyFrom(T1),
    })) as Schedule

    const result = (await branchScheduleRepeating.execute(auth, {
      schedule_id: origin.uuid,
      new: { name: 'branch-weekly', event_time: atTime(NEXT_OCCURRENCE) },
      end_time: NEXT_OCCURRENCE,
    })) as BranchScheduleResult
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
      message: string
      confirmToken: string
      action: string
      target: { schedule_id: string }
    }
    expect(step1.status).toBe('confirm_required')
    expect(step1.action).toBe('delete_schedule')
    expect(step1.target).toEqual({ schedule_id: created.uuid })
    expect(typeof step1.confirmToken).toBe('string')
    // schedule만의 차별 안전 신호 — '반복 occurrence 전체 삭제'를 LLM이 사용자에게 경고하도록
    // tool description에 박혀 있는 문구. 회귀로 잡아둠.
    expect(step1.message).toContain('and all of its occurrences')

    const step2 = (await deleteSchedule.execute(auth, {
      schedule_id: created.uuid,
      confirmToken: step1.confirmToken,
    })) as { status: string }
    expect(step2.status).toBe('ok')
  })
})
