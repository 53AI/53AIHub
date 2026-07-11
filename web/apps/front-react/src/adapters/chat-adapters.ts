import type {
  IChatAdapters,
  IConversationApi,
  IAgentApi,
  ChatCompletionParams,
} from '@km/shared-business/chat'
import {
  buildOpenClawConversation as buildSharedOpenClawConversation,
  buildOpenClawMessages as buildSharedOpenClawMessages,
  createOpenClawConversationApiAdapter as createSharedOpenClawConversationApiAdapter,
} from '@km/shared-business/chat'
import { feedbackApi } from '@/api/modules/feedback'
import { sharesApi } from '@/api/modules/share'
import chatApi from '@/api/modules/chat'
import conversationApi from '@/api/modules/conversation'
import agentsApi from '@/api/modules/agents'
import chunksApi from '@/api/modules/chunks'
import filesApi from '@/api/modules/files'
import recentUsedApi from '@/api/modules/recent-used'
import openclawApi, { type OpenClawSession } from '@/api/modules/openclaw'
import { createAgentRunAdapter } from './agent-run-adapter'
import { useUserStore } from '@/stores/modules/user'
import { useConversationStore } from '@/stores/modules/conversation'
import { checkPermission } from '@/utils/permission'
import { buildUrl } from '@/utils/router'
import { t } from '@/locales'
import { copyToClip, encodeShortId } from '@km/shared-utils'
import { message } from 'antd'
import { markdownPreview } from '@/components/Markdown/helper'

/**
 * front-react Conversation API Adapter
 * 桥接 shared-business 的 IConversationApi 和 front-react 的 API
 */
export const conversationApiAdapter: IConversationApi = {
  create: async (agentId: string, question: string, title?: string, type?: string) => {
    const conversationType = type ? Number(type) : undefined
    return conversationApi.create({
      agent_id: agentId,
      title: title || question.slice(0, 20),
      conversation_type: conversationType as any,
    })
  },

  list: async (agentId: string, params?: { conversation_type?: string; offset?: number; limit?: number }) => {
    const result = await conversationApi.list({
      agent_id: agentId,
      conversation_type: (params?.conversation_type ? Number(params.conversation_type) : undefined) as any,
      offset: params?.offset,
      limit: params?.limit,
    })
    return result
  },

  messages: async (conversationId: string, params?: { offset?: number; limit?: number }) => {
    return conversationApi.messasges(conversationId, {
      offset: params?.offset ?? 0,
      limit: params?.limit ?? 20,
    })
  },

  edit: async (conversationId: string, data: { title: string }) => {
    return conversationApi.edit(conversationId, {
      title: data.title,
      file_id: '',
    })
  },

  del: async (conversationId: string) => {
    return conversationApi.del(conversationId)
  },

  completions: async (
    params: ChatCompletionParams,
    options: {
      responseType: 'stream'
      onDownloadProgress: (e: any) => void
      signal?: AbortSignal
    },
  ) => {
    return chatApi.completions({ ...params, source: 'web' } as any, {
      responseType: 'stream',
      onDownloadProgress: options.onDownloadProgress,
      signal: options.signal,
    })
  },
}

export function buildOpenClawConversation(session: OpenClawSession, agentId: string | number) {
  return buildSharedOpenClawConversation(session as any, agentId)
}

export const buildOpenClawMessages = buildSharedOpenClawMessages

/**
 * OpenClaw Conversation API Adapter
 * OpenClaw 会话与消息来自插件侧，不走 53AIHub 平台会话接口。
 */
export function createOpenClawConversationApiAdapter(agentId: string | number): IConversationApi {
  return createSharedOpenClawConversationApiAdapter({
    agentId,
    openclawApi,
    completions: (params, options) =>
      chatApi.completions(params as any, {
        responseType: 'stream',
        onDownloadProgress: options.onDownloadProgress,
        signal: options.signal,
      }),
    requestSource: 'web',
    canonicalOnly: true,
  })
}

/**
 * front-react Agent API Adapter
 * 桥接 shared-business 的 IAgentApi 和 front-react 的 API
 */
export const agentApiAdapter: IAgentApi = {
  detail: async (agentId: string | number) => {
    const res = await agentsApi.detail(String(agentId))
    return transformAgentInfo((res as any)?.data ?? res)
  },

  list: async () => {
    const res = await agentsApi.list({ offset: 0, limit: 20 })
    const payload = (res as any)?.data ?? res
    return (payload?.agents || []).map(transformAgentInfo)
  },

  myDetail: async (agentId: string | number) => {
    const res = await agentsApi.my.detail(agentId)
    return transformAgentInfo((res as any)?.data ?? res)
  },

  myList: async () => {
    const res = await agentsApi.my.list({ offset: 0, limit: 20 })
    const payload = (res as any)?.data ?? res
    return (payload?.agents || []).map(transformAgentInfo)
  },
}

/**
 * 转换 Agent 信息格式（输出带 `_obj` 后缀的字段，专供 IAgentApi 消费方使用）
 */
function transformAgentInfo(raw: any): any {
  if (!raw) return null
  return {
    ...raw,
    custom_config_obj: raw.custom_config ? JSON.parse(raw.custom_config) : {},
    settings_obj: raw.settings ? JSON.parse(raw.settings) : {},
    configs: raw.configs ? JSON.parse(raw.configs) : {},
    use_cases: raw.use_cases ? JSON.parse(raw.use_cases) : [],
  }
}

/**
 * front-react 聊天模块适配器实现
 *
 * 使用方式：
 * ```tsx
 * import { ChatConfigProvider } from '@km/shared-business/chat'
 * import { chatAdapters } from '@/adapters/chat-adapters'
 *
 * function ChatPage() {
 *   return (
 *     <ChatConfigProvider adapters={chatAdapters}>
 *       <ChatView />
 *     </ChatConfigProvider>
 *   )
 * }
 * ```
 */
export const chatAdapters: IChatAdapters = {
  // ========== Feedback 适配器 ==========
  feedback: {
    api: {
      getConfig: (params) => feedbackApi.getConfig(params),
      getFeedback: (params) => feedbackApi.getFeedback(params),
      createFeedback: (body) => feedbackApi.createFeedback(body),
      updateFeedback: (id, body) => feedbackApi.updateFeedback(id, body),
      deleteFeedback: (id) => feedbackApi.deleteFeedback(id),
    },
    context: {
      getEid: () => useUserStore.getState().info.eid,
    },
  },

  // ========== Share 适配器 ==========
  share: {
    api: {
      create: (data) => sharesApi.create(data as any),
    },
    context: {
      buildUrl,
      t,
      showSuccess: (msg) => message.success(msg),
      copyToClipboard: copyToClip,
      encodeShortId,
    },
  },

  // ========== Messages 适配器 ==========
  messages: {
    api: {
      loadMessages: (conversationId, params) => conversationApi.messasges(conversationId, params),
    },
  },

  // ========== Chunk Popup 适配器 ==========
  chunkPopup: {
    fetchChunkDetail: async (chunkId) => {
      const chunk = await chunksApi.get(chunkId as any)
      return {
        content: chunk.content,
        token_count: chunk.token_count,
        chunk_index: chunk.chunk_index,
      }
    },
    renderMarkdown: async (element, content) => {
      await markdownPreview(element, content)
    },
  },

  // ========== File Link 适配器 ==========
  fileLink: {
    getFileLink: (file) => {
      // 空间：跳转到知识首页，并选中对应空间的 tab
      if (file.isspace) {
        return `/knowledge/${file.id}`
      }
      // 知识库：跳转到知识库详情
      if (file.islibrary) {
        return `/library/${file.id}`
      }
      // 文件夹：跳转到文件夹详情
      if (file.isfolder) {
        return `/library/${file.library_id}/folder/${file.id}`
      }
      // 文件：跳转到文件详情
      return `/library/${file.library_id}/file/${file.id}`
    },
  },

  // ========== File Download 适配器 ==========
  fileDownload: {
    downloadFile: async (id) => {
      const res = await filesApi.downloadFile(id)
      return new Blob([res.data || res])
    },
  },

  // ========== Agent Run 适配器 ==========
  // 为 useAgentRun hook 提供 IAgentRunApi 实现，支持页面刷新后恢复
  // agent 运行状态、实时监听事件、取消运行。
  agentRun: createAgentRunAdapter(),

  // ========== Recent Used 适配器 ==========
  // useChatSend 在发送时调用，保存 @ 文件/知识库/空间的最近使用记录。
  // 对齐旧版 apps/front-react/src/useChatSend.ts:391-399 的 recentUsedApi.save 调用。
  recentUsed: {
    save: (data) => recentUsedApi.save(data as any),
  },

  // ========== 平台工具（unify-chat-adapters 新增） ==========
  // 给 useWorkflowSend 等 hook 注入 createConversation / t / showWarning。
  // 原 chatAdapters.workflow 中的同名字段迁到这里。
  platform: {
    createConversation: (agentId, title, fileId) =>
      useConversationStore.getState().createConversation(agentId, title, fileId),
    t,
    showWarning: (msg) => message.warning(msg),
  },

  // ========== 权限工具（unify-chat-adapters 新增） ==========
  // 给 useWorkflowSend 等 hook 注入 checkPermission。
  permission: {
    checkPermission: (options) => checkPermission(options),
  },

  // ========== 会话级运行时（unify-chat-adapters 收口） ==========
  // ChatView / CompletionView 通过 useChatAdapters() 读这些字段。
  // 单例默认使用普通 `conversationApiAdapter`（非 OpenClaw 场景）；
  // ChatContainer 在 OpenClaw 模式下会用 createChatAdapters(...) 覆盖 conversationApi。
  conversationApi: conversationApiAdapter,
  agentApi: agentApiAdapter,
  workflowApi: {
    run: (data, options) => chatApi.workflow.run(data as any, (options ?? {}) as any),
  },
}
