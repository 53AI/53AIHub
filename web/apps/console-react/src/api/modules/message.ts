import service from '../config'
import { handleError } from '../error-handler'

export const messageApi = {
  fetch_conversation_messages(params: {
    conversation_id: number | string
    keyword?: string
    direction?: 'desc' | 'asc'
    offset?: number
    limit?: number
    /** 游标：取 id 小于该值的相邻消息（上一条），传此参数时忽略 offset/direction */
    before_id?: number | string
    /** 游标：取 id 大于该值的相邻消息（下一条），传此参数时忽略 offset/direction */
    after_id?: number | string
  }) {
    const conversation_id = params.conversation_id
    delete (params as any).conversation_id
    return service
      .get(`/api/conversations/${conversation_id}/messages`, { params })
      .catch(handleError)
  },
}

export default messageApi

