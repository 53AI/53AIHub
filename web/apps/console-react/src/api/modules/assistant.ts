import service from '../config'
import { handleError } from '../errorHandler'

interface AssistantParams {
  keyword?: string
  offset?: number
  limit?: number
}

interface AssistantItem {
  assistant_id: number
  name: string
  description: string
  type: string
  status: number
  created_time: string
}

interface AssistantListResponse {
  list: AssistantItem[]
  total: number
}

interface ChatSettings {
  model: string
  temperature: number
  max_tokens: number
  enable_stream: boolean
  enable_history: boolean
  history_count: number
  system_prompt: string
}

export const assistantApi = {
  async list(params: AssistantParams = {}): Promise<AssistantListResponse> {
    const res = await service.get('/api/assistants', { params }).catch(handleError) as any
    return {
      list: res?.data?.list || [],
      total: res?.data?.total || 0,
    }
  },

  async getChatSettings(): Promise<ChatSettings> {
    const res = await service.get('/api/assistants/chat/settings').catch(handleError) as any
    return res?.data || {}
  },

  async saveChatSettings(data: ChatSettings): Promise<void> {
    return service.post('/api/assistants/chat/settings', data).catch(handleError)
  },
}

export default assistantApi