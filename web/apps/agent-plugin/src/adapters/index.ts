import type { IChatAdapters } from '@km/shared-business/chat'
import { agentConversationApi } from './conversation'
import { agentAgentApi } from './agent'
import { workflowApi } from './workflow'

// unify-chat-adapters：原 PluginAdapters 已并入 IChatAdapters。
// uploadApi 由 host 端通过 fileUpload.request 显式注入（agent-plugin
// 的 views/chat/index.tsx 直接 import agentUploadApi），不通过 adapters。
export const adapters: IChatAdapters = {
  conversationApi: agentConversationApi,
  agentApi: agentAgentApi,
  workflowApi,
}

export { workflowApi }
