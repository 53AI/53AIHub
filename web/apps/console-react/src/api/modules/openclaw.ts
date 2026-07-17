import service from '../config'
import { handleError } from '../error-handler'
import type {
  OpenClawPaginationParams,
  ConversationControlParams as OpenClawControlParams,
} from '@km/shared-business/chat'

function buildPaginationParams(params: OpenClawPaginationParams = {}) {
  const query: OpenClawPaginationParams = {}
  if (typeof params.limit === 'number' && params.limit > 0) {
    query.limit = params.limit
  }
  if (typeof params.offset === 'number' && params.offset > 0) {
    query.offset = params.offset
  }
  if (typeof params.after_seq === 'number' && params.after_seq > 0) {
    query.after_seq = params.after_seq
  }
  return query
}

export const openclawApi = {
  conversations(agentId: string | number, params: OpenClawPaginationParams = {}) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations`, {
        params: buildPaginationParams(params),
        requiresAuth: true,
      })
      .catch(handleError)
  },

  currentConversation(agentId: string | number) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations/current`, {
        requiresAuth: true,
      })
      .catch(handleError)
  },

  messages(agentId: string | number, conversationId: string, params: OpenClawPaginationParams = {}) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/messages`, {
        params: buildPaginationParams(params),
        requiresAuth: true,
      })
      .catch(handleError)
  },

  events(agentId: string | number, conversationId: string, params: OpenClawPaginationParams = {}) {
    return service
      .get(`/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/events`, {
        params: buildPaginationParams(params),
        requiresAuth: true,
      })
      .catch(handleError)
  },

  control(agentId: string | number, conversationId: string, params: OpenClawControlParams) {
    return service
      .post(`/api/openclaw/agents/${agentId}/conversations/${encodeURIComponent(conversationId)}/control`, params, {
        requiresAuth: true,
      })
      .catch(handleError)
  },

  status(agentId: string | number, options?: { ignoreMessage?: boolean }) {
    return service
      .get(`/api/openclaw/agents/${agentId}/status`, { requiresAuth: true })
      .catch((error) => handleError(error, { ignoreMessage: options?.ignoreMessage }))
  },
}

export default openclawApi
