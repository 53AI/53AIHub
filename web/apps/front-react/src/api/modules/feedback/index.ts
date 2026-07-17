import service from '../../config'
import { handleError } from '../../errorHandler'

export interface FeedbackRequest {
  description: string
  feedback_type: string
  message_id: string | number
  question: string
  reason: string
}

export const feedbackApi = {
  getConfig(params: { eid: string, type?: string }) {
    return service.get(`/api/feedback/config`, { params, requiresAuth: true }).then(res => res.data).catch(handleError)
  },
  getFeedback(params: { message_id: string | number }) {
    return service.get(`/api/feedback`, { params }).then(res => res.data)
  },
  createFeedback(body: FeedbackRequest) {
    return service.post(`/api/feedback`, body).then(res => res.data).catch(handleError)
  },
  updateFeedback(id: number, body: FeedbackRequest) {
    return service.put(`/api/feedback/${id}`, body).then(res => res.data).catch(handleError)
  },
  deleteFeedback(id: number) {
    return service.delete(`/api/feedback/${id}`).then(res => res.data).catch(handleError)
  },
}

export default feedbackApi
