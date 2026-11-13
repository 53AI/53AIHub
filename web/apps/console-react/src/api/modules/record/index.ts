import service from '../../config'
import { handleError } from '../../error-handler'
import messageApi from '../message'
import type { RecordItem, RecordDisplayItem, RecordListRequest } from './types'
import { transformRecordItem, transformRecordList } from './transform'

export const recordApi = {
  getMessageStats(params: { start_date: number; end_date: number; agent_id?: string; source?: string | null }) {
    return service
      .get('/api/message_stats/sum', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  getMessageList(params: RecordListRequest) {
    return service
      .get('/api/messages/list', { params })
      .then((res: any) => {
        return {
          messages: transformRecordList(res.data.messages),
          total: res.data.count,
        }
      })
      .catch(handleError)
  },
  getKnowledgeMapStats(params: { start_date: number; end_date: number; agent_id?: string }) {
    return service
      .get('/api/knowledge_map_stats/sum', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  /**
   * 会话内相邻消息（按 message id 游标，只取 1 条）。
   * 问答明细详情抽屉的「加载上一条 / 加载下一条」使用，不拉整段会话。
   */
  async getNeighborMessage(params: {
    conversation_id: number | string
    message_id: number | string
    direction: 'prev' | 'next'
  }): Promise<RecordDisplayItem | null> {
    const payload: any = await messageApi.fetch_conversation_messages({
      conversation_id: params.conversation_id,
      limit: 1,
      ...(params.direction === 'prev'
        ? { before_id: params.message_id }
        : { after_id: params.message_id }),
    })
    const item = payload?.data?.messages?.[0]
    return item ? transformRecordItem(item as RecordItem) : null
  },
}

export default recordApi
export * from './types'
export * from './transform'

