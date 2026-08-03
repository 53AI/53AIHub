import { create } from 'zustand';
import { conversationApi, type ChatCompletionParams } from '@/api/modules/conversation';
import { buildKnowledgeSourcePayload } from '@km/shared-business/agent-create';

interface ConversationState {
  loadListData: (opts?: { data?: { offset?: number; limit?: number } }) => Promise<unknown[]>
  save: (opts?: { data?: Record<string, unknown> }) => Promise<unknown>
  chat: (opts?: {
    data?: ChatCompletionParams
    onDownloadProgress?: (e: unknown) => void
    signal?: AbortSignal
    hideError?: boolean
  }) => Promise<unknown>
}

export const useConversationStore = create<ConversationState>(() => ({
  async loadListData({ data: { offset, limit } = {} } = {}) {
    const { conversations = [] } = await conversationApi.list({ offset, limit })
    return conversations.map((item: any = {}) => {
      return item
    })
  },

  async save({ data = {} } = {}) {
    const d = {
      conversation_id: 0,
      agent_id: 0,
      ...data,
    } as Record<string, unknown>
    if (!d.conversation_id) {
      delete d.conversation_id
      return conversationApi.create(d)
    } else {
      return conversationApi.update(d.conversation_id as number, d)
    }
  },

  async chat({ data, onDownloadProgress, signal, hideError } = {}) {
    const completionParams = (data as any)?.agent_configs?.completion_params || {
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      temperature: 0.2,
      top_p: 0.75,
    }

    // Need to delete agent_configs here, otherwise some channels will report errors
    const chatData = { ...data } as Record<string, unknown>
    if ((chatData as any).agent_configs) delete (chatData as any).agent_configs

    const finalData: ChatCompletionParams = {
      conversation_id: 0,
      frequency_penalty: completionParams.frequency_penalty || 0,
      messages: [],
      model: '',
      presence_penalty: completionParams.presence_penalty || 0,
      stream: true,
      temperature: completionParams.temperature || 0,
      top_p: completionParams.top_p || 0,
      ...chatData,
    }

    if (finalData.agent_id) {
      // modelId 拼到 model 后缀（AI 搜问场景），普通智能体不带后缀
      const modelId = (finalData as any).modelId
      finalData.model = `agent-${finalData.agent_id}${modelId ? `-${modelId}` : ''}`
      delete finalData.agent_id
      if (modelId) delete (finalData as any).modelId
    }

    // minimal 模式：普通智能体。不带 enable_process_steps / knowledge_base_ids /
    // search_config 等知识库字段，对应后端 agent.json payload 形态。
    const isMinimal = (finalData as any).type === 'agent' || (finalData as any).minimalParams === true
    if (!isMinimal) {
      const knowledgeSource = (finalData as any).knowledgeSource
      const agentInfo = (finalData as any).agentInfo
      const library = (finalData as any).library
      const rerankConfig = agentInfo?.settings?.rerank_config || {}
      const webSearchConfig = agentInfo?.settings?.web_search_setting || {}
      // networkSearch 时不指定知识库（使用空数组），其他模式默认全部知识库
      const isNetworkSearch = knowledgeSource?.state?.networkSearch
      const useAllKnowledge = !isNetworkSearch && (
        !knowledgeSource ||
        knowledgeSource?.state?.allKnowledge
      )

      Object.assign(finalData, {
        enable_process_steps: true,
        knowledge_base_ids: isNetworkSearch ? [] : (useAllKnowledge ? ['all'] : library?.value ?? []),
        file_ids: [],
        space_ids: [],
        solo_file_mode: false,
        search_config: {
          ...rerankConfig,
          top_k: isNetworkSearch
            ? webSearchConfig.top_k ?? rerankConfig.top_k
            : rerankConfig.top_k,
        },
        ...(knowledgeSource ? buildKnowledgeSourcePayload(knowledgeSource) : {}),
      })
      delete (finalData as any).knowledgeSource
      delete (finalData as any).library
      delete (finalData as any).agentInfo
    }
    delete (finalData as any).type
    delete (finalData as any).minimalParams

    return conversationApi.chat(finalData, { onDownloadProgress, signal, hideError })
  },
}))
