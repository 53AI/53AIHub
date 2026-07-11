import service from '../../config'
import { handleError } from '../../error-handler'
import type { FeedbackListRequest } from './types'
import { transformFeedbackList, formatRagStats, formtMessage } from './transform'
import { JSONParse } from '@/utils'

export const feedbackApi = {
  getConfig(params: { eid: string; type?: 'message' | 'knowledge_map' | 'work_ai' | 'chat' | 'workflow' }) {
    return service
      .get('/api/feedback/config', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  updateConfig(body: {
    type?: 'message' | 'knowledge_map' | 'work_ai' | 'chat' | 'workflow'
    satisfied: string[]
    unsatisfied: string[]
  }) {
    return service
      .post('/api/feedback/config', body)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  getFeedbackStatus(params: { start_time: number; end_time: number; agent_id?: string | number | null }) {
    return service
      .get('/api/admin/feedback/stats', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  getFeedbackList(
    params: FeedbackListRequest = {
      start_time: null,
      end_time: null,
      question: null,
      feedback_type: null,
      user_id: null,
      reason: null,
      offset: 0,
      limit: 10,
    },
  ) {
    return service
      .get('/api/admin/feedback', { params })
      .then((res: any) => {
        return {
          feedbacks: transformFeedbackList(res.data.feedbacks),
          total: res.data.total,
        }
      })
      .catch(handleError)
  },
  getMessage(id: number | string) {
    return service
      .get(`/api/messages/${id}`)
      .then((res: any) => {
        const message = JSONParse(
          res.data.message,
          typeof res.data.message === 'string' ? [{ role: 'user', content: res.data.message }] : [],
        )
        const userMessage = message.find((item: any) => item.role === 'user') || { content: '' }
        return {
          ...res.data,
          question: userMessage.content,
          ...formtMessage(res.data),
          rag_stats: formatRagStats(res.data.rag_stats),
        }
      })
      .catch(handleError)
  },
}

export default feedbackApi
export * from './types'
export * from './transform'

