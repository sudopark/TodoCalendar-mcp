import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InsufficientScopeError } from '../../src/openapi/errors.js'

const callOpenApi = vi.fn()

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: (...args: unknown[]) => callOpenApi(...args),
}))

const { getTags } = await import('../../src/tools/tagTools.js')

const auth = { userId: 'u-1' }

beforeEach(() => {
  callOpenApi.mockReset()
})

describe('get_tags', () => {
  it('GET /v2/open/tags/all 호출, 인자 없음', async () => {
    callOpenApi.mockResolvedValue([])
    await getTags.execute(auth, {})
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/tags/all')
  })

  it('raw 응답 — userId·color_hex 보존', async () => {
    const raw = [
      { uuid: 'tag-1', userId: 'u-1', name: 'work', color_hex: '#ff0000' },
      { uuid: 'tag-2', userId: 'u-1', name: 'personal', color_hex: null },
    ]
    callOpenApi.mockResolvedValue(raw)
    const result = await getTags.execute(auth, {})
    expect(result).toEqual(raw)
  })

  it('알 수 없는 인자도 통과 (zod object는 unknown key 허용)', async () => {
    callOpenApi.mockResolvedValue([])
    await getTags.execute(auth, { unexpected: 'value' })
    expect(callOpenApi).toHaveBeenCalled()
  })

  it('InsufficientScope → ToolError', async () => {
    callOpenApi.mockRejectedValue(new InsufficientScopeError('read:calendar'))
    await expect(getTags.execute(auth, {})).rejects.toThrow(
      /The auth token lacks the required scope\. \(read:calendar\)/,
    )
  })
})
