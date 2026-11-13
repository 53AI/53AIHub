import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchConversationMessages = vi.fn()

vi.mock('../message', () => ({
  default: {
    fetch_conversation_messages: (...args: unknown[]) => fetchConversationMessages(...args),
  },
}))

const { recordApi } = await import('./index')

const buildPayload = (messages: unknown[]) => ({
  code: 0,
  data: { count: messages.length, messages },
})

describe('recordApi.getNeighborMessage', () => {
  beforeEach(() => {
    fetchConversationMessages.mockReset()
  })

  it('上一轮只取 1 条并带 before_id 游标', async () => {
    fetchConversationMessages.mockResolvedValue(buildPayload([]))

    await recordApi.getNeighborMessage({
      conversation_id: 'oPmVlr',
      message_id: 'ZTSbMU',
      direction: 'prev',
    })

    expect(fetchConversationMessages).toHaveBeenCalledTimes(1)
    expect(fetchConversationMessages.mock.calls[0][0]).toEqual({
      conversation_id: 'oPmVlr',
      limit: 1,
      before_id: 'ZTSbMU',
    })
  })

  it('下一轮只取 1 条并带 after_id 游标', async () => {
    fetchConversationMessages.mockResolvedValue(buildPayload([]))

    await recordApi.getNeighborMessage({
      conversation_id: 12,
      message_id: 34,
      direction: 'next',
    })

    expect(fetchConversationMessages.mock.calls[0][0]).toEqual({
      conversation_id: 12,
      limit: 1,
      after_id: 34,
    })
  })

  it('没有相邻消息时返回 null', async () => {
    fetchConversationMessages.mockResolvedValue(buildPayload([]))

    const result = await recordApi.getNeighborMessage({
      conversation_id: 'oPmVlr',
      message_id: 'ZTSbMU',
      direction: 'next',
    })

    expect(result).toBeNull()
  })

  it('接口异常（返回 undefined）时不抛错，返回 null', async () => {
    fetchConversationMessages.mockResolvedValue(undefined)

    const result = await recordApi.getNeighborMessage({
      conversation_id: 'oPmVlr',
      message_id: 'ZTSbMU',
      direction: 'prev',
    })

    expect(result).toBeNull()
  })

  it('有数据时转换成列表行结构（便于详情复用同一套渲染）', async () => {
    fetchConversationMessages.mockResolvedValue(
      buildPayload([
        {
          id: 'prevId',
          conversation_id: 'oPmVlr',
          user_id: 7,
          message: JSON.stringify([{ role: 'user', content: '旧问题' }]),
          answer: '旧回答',
          original_question: '旧问题',
          rewritten_question: '旧问题改写',
          thinking_mode: 1,
          response_status: 1,
          knowledge_type: 1,
          citation_count: 2,
          updated_time: 1700000000000,
          parsed_message: [],
        },
      ]),
    )

    const result = await recordApi.getNeighborMessage({
      conversation_id: 'oPmVlr',
      message_id: 'ZTSbMU',
      direction: 'prev',
    })

    expect(result?.id).toBe('prevId')
    expect(result?.original_question).toBe('旧问题')
    expect(result?.nickname).toBe('')
    expect(typeof result?.updated_time).toBe('string')
  })
})
