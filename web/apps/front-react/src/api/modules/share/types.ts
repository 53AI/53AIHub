export interface ShareCreateRequest {
  message_ids: string | number[]
  conversation_id: number | string
  select_all: boolean
}

export interface ShareCreateResponse {
  share_id: string
}

export interface ShareFindReponse {
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
  messages: [
    {
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
    }
  ]
}
