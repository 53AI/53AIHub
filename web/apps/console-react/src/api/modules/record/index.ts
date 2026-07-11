import service from '../../config'
import { handleError } from '../../error-handler'
import type { RecordListRequest } from './types'
import { transformRecordList } from './transform'

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
}

export default recordApi
export * from './types'
export * from './transform'

