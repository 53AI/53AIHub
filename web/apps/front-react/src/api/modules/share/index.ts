import request from '../../index'

export interface ShareCreateRequest {
  message_ids: string | number[]
  conversation_id: number | string
  select_all: boolean
}

export interface ShareCreateResponse {
  share_id: string
}

export interface ShareFindResponse {
  conversation: {
    id: number
    title: string
    created_time: string
  }
  user: {
    nickname: string
    avatar: string
  }
  agent: {
    name: string
    logo: string
    model: string
    description: string
    agent_id: string
  }
  messages: Array<{
    id: number
    eid: number
    user_id: number
    message: string
    agent_id: string
    conversation_id: number
    answer: string
    reasoning_content: string
    model_name: string
    quota: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    channel: number
    request_id: string
    elapsed_time: number
    is_stream: boolean
    quota_content: string
    agent_custom_config: string
    created_time: number
    updated_time: number
    message_type: 'chat'
    parsed_message: { content: string; role: 'user' | 'assistant' }[]
    parsed_answer: string
  }>
}

export const sharesApi = {
  create(data: ShareCreateRequest): Promise<ShareCreateResponse> {
    return request.post('/api/shares', data).then((res) => res.data)
  },

  find(id: string): Promise<ShareFindResponse> {
    return request.get(`/api/shares/${id}`).then((res) => res.data)
  }
}

export default sharesApi
