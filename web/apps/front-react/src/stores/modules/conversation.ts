import { create } from 'zustand'
import { useMemo } from 'react'
import conversationApi, { Conversation_Type } from '@/api/modules/conversation/index'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { setRouterQuery } from '@/utils/router'
import { isHashRouter, pathIncludes } from '@/router'
import { AGENT_USAGES } from '@/constants/agent'
import { isOpenClawConversationId } from '@km/shared-business/chat'

interface RouterOptions {
  agent_id?: string | null
  conversation_id?: number | string | null
}

function isConversationHistoryRoute() {
  return pathIncludes('/chat') || pathIncludes('/agent/agent')
}

export const useCurrentConversation = () => {
  const currentConversationId = useConversationStore((state) => state.current_conversationid)
  const conversations = useConversationStore((state) => state.conversations)
  return useMemo(() => {
    // conversation_id 可以是字符串或数字，统一使用字符串比较
    const targetId = String(currentConversationId)
    const conversation = conversations.find((item) => String(item.conversation_id) === targetId)
    if (conversation) {
      return conversation
    }
    // 如果找不到会话，返回一个包含 conversation_id 的虚拟对象（用于触发消息加载）
    if (currentConversationId && currentConversationId !== 0 && currentConversationId !== '0') {
      return {
        conversation_id: currentConversationId,
        title: '',
        created_time: 0,
        updated_time: 0
      } as Conversation.Info
    }
    return undefined
  }, [conversations, currentConversationId])
}

interface ConversationState {
  conversations: Conversation.Info[]
  current_agentid: string
  current_conversationid: number | string
  base_path: string
  next_agent_prepare: Partial<Conversation.NextAgentPrepare>
  currentVirtualId: string
  // Computed getters
  currentConversation: () => Conversation.Info | { conversation_id: number; title: string; create_time: number; update_time: number; top: number; is_valid: number; virtual_id: string }
  // Actions
  setNextAgentPrepare: (data: Partial<Conversation.NextAgentPrepare>) => void
  setBasePath: (path: string) => void
  loadConversations: (agent_id?: string) => Promise<Conversation.Info[]>
  createConversation: (agent_id: string, title?: string, file_id?: string, conversation_type?: Conversation_Type) => Promise<Conversation.Info>
  addConversation: (conversation: Conversation.Info) => void
  updateConversation: (conversation: Partial<Conversation.Info>) => void
  editConversation: (conversation: Pick<Conversation.Info, 'conversation_id' | 'title'>) => Promise<void>
  delConversation: (conversation: Conversation.Info) => Promise<void>
  setCurrentState: (agent_id: string, conversation_id: number | string, isReplace?: boolean) => void
  clearCurrentState: () => void
  setRouter: (data: RouterOptions) => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  current_agentid: '',
  current_conversationid: 0,
  base_path: '/chat',
  next_agent_prepare: {},
  currentVirtualId: '',

  // Getters
  currentConversation: () => {
    const state = get()
    // conversation_id 可以是字符串或数字，统一使用字符串比较
    const targetId = String(state.current_conversationid)
    const conversation = state.conversations.find(
      (item) => String(item.conversation_id) === targetId
    )

    if (conversation) {
      return conversation
    }

    // 新建会话：复用缓存的 virtual_id，如果没有再生成
    if (!state.currentVirtualId) {
      set({ currentVirtualId: Date.now().toString() })
    }

    return {
      conversation_id: 0,
      title: '',
      create_time: 0,
      update_time: 0,
      top: 0,
      is_valid: 0,
      virtual_id: get().currentVirtualId
    }
  },

  // Actions
  setNextAgentPrepare: (data) => {
    set({ next_agent_prepare: data })
  },

  setBasePath: (path) => {
    set({ base_path: path || '/chat' })
  },

  loadConversations: async (agent_id) => {
    const state = get()
    const targetAgentId = agent_id || state.current_agentid
    // 不传 agent_id 时获取所有会话，传 0 会返回空数据
    const params: { agent_id?: string } = {}
    if (targetAgentId && targetAgentId !== '') {
      params.agent_id = targetAgentId
    }
    const res = await conversationApi.list(params)
    const conversations = res.data.conversations.filter(item => {
      if (item.agent && item.agent.agent_usage > AGENT_USAGES.HUB) {
        return false
      }
      return true
    }).map((item) => {
      return {
        ...item,
        created_at: getSimpleDateFormatString({
          date: item.created_time,
          format: 'YYYY.MM.DD hh:mm'
        }),
        updated_at: getSimpleDateFormatString({
          date: item.updated_time,
          format: 'YYYY.MM.DD hh:mm'
        })
      }
    })

    // 如果新对话不在列表中，手动添加到列表
    const currentId = get().current_conversationid
    if (currentId && currentId !== 0) {
      const currentInNew = conversations.find((c: Conversation.Info) => c.conversation_id === currentId)
      const oldCurrent = state.conversations.find((c: Conversation.Info) => c.conversation_id === currentId)
      if (!currentInNew && oldCurrent) {
        conversations.unshift(oldCurrent)
      }
    }
    set({ conversations })
    return conversations
  },

  createConversation: (agent_id, title = '', file_id = '', conversation_type) => {
    const data: { agent_id: string, title: string, file_id?: string, conversation_type?: Conversation_Type } = {
      agent_id,
      title,
      file_id
    }
    if (!file_id) {
      delete data.file_id
    }
    if (conversation_type !== undefined) {
      data.conversation_type = conversation_type
    }
    return conversationApi
      .create(data)
      .then((res) => res.data)
  },

  addConversation: (conversation) => {
    const newConversation = {
      ...conversation,
      created_at: getSimpleDateFormatString({
        date: conversation.created_time,
        format: 'YYYY.MM.DD hh:mm'
      }),
      updated_at: getSimpleDateFormatString({
        date: conversation.updated_time,
        format: 'YYYY.MM.DD hh:mm'
      })
    }
    set((state) => ({
      conversations: [newConversation, ...state.conversations]
    }))
  },

  updateConversation: (conversation) => {
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.conversation_id === conversation.conversation_id ? { ...item, ...conversation } : item
      )
    }))
  },

  editConversation: async (conversation) => {
    const data = { title: conversation.title }
    await conversationApi.edit(conversation.conversation_id, data)
    get().updateConversation(conversation)
  },

  delConversation: async (conversation) => {
    set((state) => ({
      conversations: state.conversations.filter(
        (item) => item.conversation_id !== conversation.conversation_id
      )
    }))
    await conversationApi.del(conversation.conversation_id)
    if (get().current_conversationid === conversation.conversation_id) {
      get().setCurrentState(get().current_agentid, 0)
    }
  },

  setCurrentState: (agent_id, conversation_id, isReplace = true) => {
    set((state) => {
      if (state.current_conversationid !== conversation_id || state.current_agentid !== agent_id) {
        return {
          current_agentid: agent_id,
          current_conversationid: conversation_id,
          currentVirtualId: ''
        }
      }
      return {
        current_agentid: agent_id,
        current_conversationid: conversation_id
      }
    })

    if (isReplace) {
      get().setRouter({ agent_id: get().current_agentid || null, conversation_id: get().current_conversationid || null })
    }
  },

  clearCurrentState: () => {
    set({
      current_agentid: '',
      current_conversationid: 0
    })
  },

  setRouter: (data = {}) => {
    if (!data.agent_id) return
    const state = get()
    // electron环境 需要使用hash跳转 使用setRouterQuery
    if (isHashRouter) {
      setRouterQuery(data, state.base_path)
    } else {
      const searchParams = new URLSearchParams(window.location.search)
      searchParams.set('agent_id', String(data.agent_id))
      if (data.conversation_id) {
        searchParams.set('conversation_id', String(data.conversation_id))
      } else {
        searchParams.delete('conversation_id')
      }
      if (isOpenClawConversationId(data.conversation_id)) {
        searchParams.set('type', 'openclaw')
      }
      const url = `${state.base_path}?${searchParams.toString()}`
      if (isConversationHistoryRoute()) {
        window.history.replaceState(null, '', url)
      } else {
        // React Router navigation - use window.location for store context
        window.location.href = url
      }
    }
  }
}))
