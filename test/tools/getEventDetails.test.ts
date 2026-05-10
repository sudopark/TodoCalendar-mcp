import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '../../src/openapi/errors.js'

const callOpenApi = vi.fn()

vi.mock('../../src/openapi/client.js', () => ({
  callOpenApi: (...args: unknown[]) => callOpenApi(...args),
}))

const { getEventDetails } = await import('../../src/tools/eventDetailTools.js')

const auth = { userId: 'u-1' }

beforeEach(() => {
  callOpenApi.mockReset()
})

describe('get_event_details — active/done 분기', () => {
  it('is_done=false → /v2/open/event_details/{id}', async () => {
    callOpenApi.mockResolvedValue({ place: '강남', url: null, memo: null })
    await getEventDetails.execute(auth, { event_id: 't-1', is_done: false })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/event_details/t-1')
  })

  it('is_done=true → /v2/open/event_details/done/{id}', async () => {
    callOpenApi.mockResolvedValue({ place: null, url: null, memo: '완료 메모' })
    await getEventDetails.execute(auth, { event_id: 'd-1', is_done: true })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/event_details/done/d-1')
  })

  it('event_id에 특수문자 — URL encoded', async () => {
    callOpenApi.mockResolvedValue({})
    await getEventDetails.execute(auth, { event_id: 'a/b c', is_done: false })
    expect(callOpenApi).toHaveBeenCalledWith(auth, 'GET', '/v2/open/event_details/a%2Fb%20c')
  })

  it('is_done 누락 — zod throw', async () => {
    await expect(getEventDetails.execute(auth, { event_id: 't-1' })).rejects.toThrow()
  })

  it('event_id 누락 — zod throw', async () => {
    await expect(getEventDetails.execute(auth, { is_done: false })).rejects.toThrow()
  })

  it('raw 응답 통과', async () => {
    const raw = { place: '강남역', url: 'https://x', memo: '메모' }
    callOpenApi.mockResolvedValue(raw)
    const result = await getEventDetails.execute(auth, { event_id: 't-1', is_done: false })
    expect(result).toEqual(raw)
  })

  it('NotFound → ToolError', async () => {
    callOpenApi.mockRejectedValue(new NotFoundError(''))
    await expect(getEventDetails.execute(auth, { event_id: 'x', is_done: false })).rejects.toThrow(
      /The requested resource does not exist\./,
    )
  })
})
