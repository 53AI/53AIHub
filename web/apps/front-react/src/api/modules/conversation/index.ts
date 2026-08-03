import service from '../../config'
import { handleError } from '../../errorHandler'

export const ConversationType = {
  FORMAL: 0, // 正式会话
  TEST: 1,   // 调试会话
} as const

export type Conversation_Type = typeof ConversationType[keyof typeof ConversationType]

/**
 * 文档引用类型（对齐 v0.4.2 文档引用统一规范 §3.2）。
 * - file: 文件单文档
 * - wiki: Wiki 页面单文档
 */
export type DocumentType = 'file' | 'wiki'

export interface CreateConversationParams {
  agent_id: string
  title: string
  conversation_type?: Conversation_Type
  /**
   * 文档引用统一字段（v0.4.2 §3.2）：`file` 或 `wiki`。
   * 与 document_id 配对使用，指定时 document_id 必须为正整数 ID。
   */
  document_type?: DocumentType
  /** 对应文件或 Wiki 页面的 Hashid（前端原样回传，不要转 int） */
  document_id?: string
}

/**
 * 列出/筛选会话时的统一文档引用参数（v0.4.2 §3.2）。
 * 不再使用旧 file_id 字段。
 */
export interface DocumentRefFilter {
  document_type?: DocumentType
  document_id?: string
}

export const conversationApi = {
  list(params: { agent_id?: string, conversation_type?: Conversation_Type, offset?: number, limit?: number } = {}) {
    return service.get(`/api/conversations`, { params, requiresAuth: true }).catch(handleError)
  },
  create(data: CreateConversationParams) {
    return service.post(`/api/conversations`, data).catch(handleError)
  },
  edit(id: string, data: { title: string }) {
    return service.put(`/api/conversations/${id}`, data).catch(handleError)
  },
  del(id: string) {
    return service.delete(`/api/conversations/${id}`).catch(handleError)
  },
  messasges(id: string, params: { keyword?: string, offset?: number, limit?: number } & DocumentRefFilter = {}) {
    return service.get(`/api/conversations/${id}/messages`, { params }).catch(handleError)
  },
  agentList(
    agent_id: string,
    params: { keyword?: string, offset?: number, limit?: number } & DocumentRefFilter = {},
  ) {
    return service.get(`/api/agents/${agent_id}/conversations`, { params: { ...params, view: 'user' } }).catch(handleError)
  },
  agentMessages(
    agent_id: string,
    params: { keyword?: string, offset?: number, limit?: number } & DocumentRefFilter = {},
  ) {
    return service.get(`/api/agents/${agent_id}/messages`, { params: { ...params, view: 'user' } }).then(res => res.data).catch(handleError)
  },
}
export default conversationApi

