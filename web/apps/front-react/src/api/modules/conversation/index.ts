import service from '../../config'
import { handleError } from '../../errorHandler'

export const ConversationType = {
  FORMAL: 0, // 正式会话
  TEST: 1,   // 调试会话
} as const

export type Conversation_Type = typeof ConversationType[keyof typeof ConversationType]

export const conversationApi = {
  list(params: { agent_id?: string, conversation_type?: Conversation_Type, offset?: number, limit?: number } = {}) {
    return service.get(`/api/conversations`, { params, requiresAuth: true }).catch(handleError)
  },
  create(data: { agent_id: string, title: string, file_id?: string, conversation_type?: Conversation_Type }) {
    return service.post(`/api/conversations`, data).catch(handleError)
  },
  edit(id: string, data: { title: string;  file_id: string| number }) {
    return service.put(`/api/conversations/${id}`, data).catch(handleError)
  },
  del(id: string) {
    return service.delete(`/api/conversations/${id}`).catch(handleError)
  },
  messasges(id: string, params: { keyword?: string, offset?: number, limit?: number, file_id?: string } = {}) {
    return service.get(`/api/conversations/${id}/messages`, { params }).catch(handleError)
  },
  agentList(agent_id: string, params: { file_id?: string | number | null, keyword?: string, offset?: number, limit?: number } = {}) {
    return service.get(`/api/agents/${agent_id}/conversations`, { params: { ...params, view: 'user'} }).catch(handleError)
  },
  agentMessages(agent_id: string, params: { file_id?: string | number | null, keyword?: string, offset?: number, limit?: number } = {}) {
    return service.get(`/api/agents/${agent_id}/messages`, { params: { ...params, view: 'user'} }).then(res => res.data).catch(handleError)
  }
}
export default conversationApi

