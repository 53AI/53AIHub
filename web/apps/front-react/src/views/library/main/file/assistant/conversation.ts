import { create } from 'zustand'
import conversationApi from '@/api/modules/conversation/index'
import { getSimpleDateFormatString } from '@km/shared-utils'

interface ConversationState {
  conversations: Conversation.Info[]
  current_conversationid: number | string
  current_agentid: string
  current_fileid: string | null
  currentVirtualId: string
  // Getters
  currentConversation: () => Conversation.Info | { conversation_id: number; title: string; create_time: number; update_time: number; top: number; is_valid: number; virtual_id: string }
  // Actions
  setAgentId: (agent_id: string) => void
  setFileId: (file_id: string | null) => void
  loadConversations: () => Promise<Conversation.Info[]>
  createConversation: (agent_id: string, title?: string, file_id?: string) => Promise<Conversation.Info>
  addConversation: (conversation: Conversation.Info) => void
  updateConversation: (conversation: Partial<Conversation.Info>) => void
  editConversation: (conversation: Pick<Conversation.Info, 'conversation_id' | 'title'>) => Promise<void>
  delConversation: (conversation: Conversation.Info) => Promise<void>
  setCurrentState: (agent_id: string, conversation_id: number | string, isReplace?: boolean) => void
  clearCurrentState: () => void
}

export const useFileConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  current_conversationid: 0,
  current_agentid: '',
  current_fileid: null,
  currentVirtualId: '',

  // Getter
  currentConversation: () => {
    const state = get()
    const targetId = String(state.current_conversationid)
    const conversation = state.conversations.find(
      (item) => String(item.conversation_id || item.id) === targetId
    )

    if (conversation) {
      return conversation
    }

    // 新建会话：返回默认对象，不在此处触发状态更新
    return {
      conversation_id: 0,
      title: '',
      create_time: 0,
      update_time: 0,
      top: 0,
      is_valid: 0,
      virtual_id: state.currentVirtualId || Date.now().toString()
    }
  },

  setAgentId: (agent_id) => {
    set({ current_agentid: agent_id })
  },

  setFileId: (file_id) => {
    set({ current_fileid: file_id })
  },

  loadConversations: async () => {
    const state = get()
    const res = await conversationApi.agentList(state.current_agentid, {
      file_id: state.current_fileid,
      offset: 0,
      limit: 100
    })
    const conversations = res.data.items.map((item) => {
      return {
        ...item,
        created_date: getSimpleDateFormatString({
          date: item.created_time,
          format: 'YYYY.MM.DD hh:mm'
        }),
        updated_date: getSimpleDateFormatString({
          date: item.updated_time,
          format: 'YYYY.MM.DD hh:mm'
        })
      }
    })
    set({ conversations })
    return conversations
  },

  createConversation: (agent_id: string, title = '', file_id?: string) => {
    const data: { agent_id: string; title: string; file_id?: string } = {
      agent_id,
      title,
    }
    if (file_id) {
      data.file_id = file_id
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
        (item.conversation_id || item.id) === (conversation.conversation_id || conversation.id)
          ? { ...item, ...conversation }
          : item
      )
    }))
  },

  editConversation: async (conversation) => {
    const data = { title: conversation.title }
    const id = conversation.conversation_id || conversation.id
    await conversationApi.edit(id as number, data)
    get().updateConversation(conversation)
  },

  delConversation: async (conversation) => {
    const id = conversation.conversation_id || conversation.id
    set((state) => ({
      conversations: state.conversations.filter(
        (item) => (item.conversation_id || item.id) !== id
      )
    }))
    await conversationApi.del(id as number)
    if (get().current_conversationid === id) {
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
  },

  clearCurrentState: () => {
    set({
      current_agentid: '',
      current_conversationid: 0
    })
  }
}))