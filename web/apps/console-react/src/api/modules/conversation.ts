import service from '../config'
import { handleError } from '../error-handler'
import type { AxiosRequestConfig } from 'axios'

export interface ConversationItem {
  conversation_id: string
  agent_id?: string
  user_id?: number
  title?: string
  created_time?: number
  updated_time?: number
  [key: string]: unknown
}

export interface ChatCompletionParams {
  conversation_id?: string
  agent_id?: string
  messages?: Array<{ role: string; content: string }>
  model?: string
  stream?: boolean
  frequency_penalty?: number
  presence_penalty?: number
  temperature?: number
  top_p?: number
  [key: string]: unknown
}

export const conversationApi = {
  /**
   * 获取对话列表
   */
  list(params?: { offset?: number; limit?: number }) {
    return service
      .get('/api/conversations', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  /**
   * 创建对话
   */
  create(data: { agent_id?: number; title?: string }) {
    return service.post('/api/conversations', data).catch(handleError)
  },

  /**
   * 更新对话
   */
  update(conversation_id: number, data: { title?: string }) {
    return service.put(`/api/conversations/${conversation_id}`, data).catch(handleError)
  },

  /**
   * 删除对话
   */
  delete(conversation_id: number) {
    return service.delete(`/api/conversations/${conversation_id}`).catch(handleError)
  },

  /**
   * 获取对话详情
   */
  detail(conversation_id: number) {
    return service.get(`/api/conversations/${conversation_id}`).catch(handleError)
  },

  /**
   * 聊天补全接口
   */
  chat(
    data: ChatCompletionParams,
    options?: {
      onDownloadProgress?: (e: any) => void
      signal?: AbortSignal
      hideError?: boolean
    },
  ) {
    return service
      .post('/v1/chat/completions', { ...data, source: 'console' }, {
        isStream: data.stream,
        onDownloadProgress: options?.onDownloadProgress,
        signal: options?.signal,
      } as any)
      .catch((err) => handleError(err, { ignoreMessage: options?.hideError }))
  },

  /**
   * 获取 Agent 的对话列表
   */
  fetch_agent_conversations(params: {
    agent_id: string | number
    keyword?: string
    created_at_start?: number
    created_at_end?: number
    offset?: number
    limit?: number
  }) {
    const { agent_id, ...rest } = params
    return service.get(`/api/agents/${agent_id}/conversations`, { params: rest }).catch(handleError)
  },

  /**
   * 获取用户的对话列表
   */
  fetch_user_conversations(params: {
    user_id: number
    keyword?: string
    created_at_start?: number
    created_at_end?: number
    offset?: number
    limit?: number
  }) {
    const { user_id, ...rest } = params
    return service.get(`/api/users/${user_id}/conversations`, { params: rest }).catch(handleError)
  },

  /**
   * 获取对话详情（别名）
   */
  fetch_conversation_detail(conversation_id: number) {
    return service.get(`/api/conversations/${conversation_id}`).catch(handleError)
  },

  /**
   * 获取对话消息列表
   */
  messages(
    id: string,
    params: { keyword?: string; offset?: number; limit?: number; file_id?: string } = {},
  ) {
    return service.get(`/api/conversations/${id}/messages`, { params }).catch(handleError)
  },

  /**
   * 聊天补全接口（兼容接口）
   */
  completions(
    data: {
      conversation_id: string
      frequency_penalty: number
      messages: { content: string; role: 'user' | 'assistant' }[]
      model: string
      presence_penalty: number
      stream: boolean
      temperature: number
      top_p: number
    },
    config?: AxiosRequestConfig,
  ) {
    return service.post('/v1/chat/completions', { ...data, source: 'console' }, config).catch(handleError)
  },

  /**
   * Workflow 运行
   */
  workflow: {
    run(
      data: {
        conversation_id: number
        model: string
        parameters: { [key: string]: any }
        stream: boolean
      },
      options?: {
        responseType?: 'stream'
        onDownloadProgress?: (e: any) => void
        signal?: AbortSignal
      },
    ) {
      return service.post('/v1/workflow/run', data, options as any).catch(handleError)
    },
  },
}

export default conversationApi
