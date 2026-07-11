import type { AxiosRequestConfig } from 'axios'
import service from '../../config'
import { handleError } from '../../errorHandler'

type WorkflowRunRequest = {
  conversation_id: string | null
  model: string
  parameters: Record<string, any>
  stream: boolean
}

export const chatApi = {
  completions(data: Conversation.Sender, config: AxiosRequestConfig) {
    return service.post(`/v1/chat/completions`, data, config).catch(handleError)
  },
  workflow: {
    run(data: WorkflowRunRequest, config: AxiosRequestConfig) {
      return service.post(`/v1/workflow/run`, data, config).catch(handleError)
    }
  }
}

export default chatApi
