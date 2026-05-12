import type { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { createTag, deleteTag, getTags, updateTag } from '../../src/tools/tagTools.js'
import type { eventTagSchema } from '../../src/tools/shared/schemas.js'
import { checkReadiness, warnIfSkipping } from './_setup/readiness.js'
import { makeIntegrationAuth } from './_setup/auth.js'

const readiness = await checkReadiness()
warnIfSkipping('tag', readiness)

type EventTag = z.infer<typeof eventTagSchema>

describe.skipIf(!readiness.ready)('integration: tag happy path', () => {
  it('create_tag — 새 tag 생성 후 uuid·userId 반환', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTag.execute(auth, {
      name: 'integration-create',
      color_hex: '#ff8800',
    })) as EventTag
    expect(created).toMatchObject({ userId: auth.userId, name: 'integration-create' })
    expect(typeof created.uuid).toBe('string')
  })

  it('get_tags — 시드 tag가 응답 array에 포함', async () => {
    const auth = makeIntegrationAuth()
    await createTag.execute(auth, { name: 'in-list' })

    const list = (await getTags.execute(auth, {})) as EventTag[]
    expect(list.some((t) => t.name === 'in-list')).toBe(true)
  })

  it('update_tag — name 갱신, uuid 보존', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTag.execute(auth, { name: 'before' })) as EventTag

    const updated = (await updateTag.execute(auth, {
      tag_id: created.uuid,
      name: 'after',
    })) as EventTag
    expect(updated.uuid).toBe(created.uuid)
    expect(updated.name).toBe('after')
  })

  it('delete_tag — status:ok 반환', async () => {
    const auth = makeIntegrationAuth()
    const created = (await createTag.execute(auth, { name: 'to-delete' })) as EventTag

    const result = (await deleteTag.execute(auth, { tag_id: created.uuid })) as {
      status: string
    }
    expect(result.status).toBe('ok')
  })
})
