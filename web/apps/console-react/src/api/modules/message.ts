import service from '../config'
import { handleError } from '../error-handler'

export const messageApi = {
  fetch_conversation_messages(params: {
    conversation_id: number
    keyword?: string
    direction?: 'desc' | 'asc'
    offset?: number
    limit?: number
  }) {
    const conversation_id = params.conversation_id
    delete (params as any).conversation_id
    return service
      .get(`/api/conversations/${conversation_id}/messages`, { params })
      .catch(handleError)
  },
}

export default messageApi

