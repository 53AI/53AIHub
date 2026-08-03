import { create } from 'zustand'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { pathIncludes } from '@/router'
import { RUNNING_STATUSES } from '@/api/modules/agentRun/types'
import type { DocumentType } from '@/api/modules/conversation'

export function isRunRunning(latestRun: any): boolean {
  if (!latestRun) return false
  return RUNNING_STATUSES.includes(latestRun.status)
}

interface RouterOptions {
  agent_id?: string | null
  conversation_id?: string | null
}

/**
 * 文档引用（v0.4.2 §3.2）：仅使用 document_type + document_id。
 */
interface ConversationDocumentRef {
  documentType?: DocumentType
  documentId?: string
}

interface KnowledgeConversationState {
  conversations: any[]
  current_conversationid: string
  base_path: string
  agent_id: string
  /** 当前激活的文档引用（v0.4.2 §3.2） */
  currentDocumentRef: ConversationDocumentRef
  // Pagination state
  offset: number
  hasMore: boolean
  loadingMore: boolean
  // Request ID for race condition prevention
  loadConversationsRequestId: number
  // Computed
  currentConversation: () => any
  // Actions
  setBasePath: (path: string) => void
  setAgentId: (agent_id: string) => void
  setDocumentRef: (ref: ConversationDocumentRef | null) => void
  loadConversations: (signal?: AbortSignal) => Promise<any[]>
  loadMoreConversations: () => Promise<void>
  createConversation: (
    agent_id: string,
    documentRef?: ConversationDocumentRef,
    title?: string,
  ) => Promise<Conversation.Info>
  addConversation: (conversation: Conversation.Info) => void
  updateConversation: (conversation: Partial<Conversation.Info>) => void
  editConversation: (conversation: Pick<Conversation.Info, 'id' | 'title'>) => Promise<void>
  delConversation: (conversation: Conversation.Info) => Promise<void>
  updateConversationLatestRun: (conversationId: string, latestRun: any | null) => void
  setCurrentState: (conversation_id: string, setRouter?: boolean) => void
  clearCurrentState: () => void
  setRouter: (data: RouterOptions) => void
}

export const useConversationStore = create<KnowledgeConversationState>((set, get) => ({
  conversations: [],
  current_conversationid: '',
  base_path: '/index',
  agent_id: '',
  currentDocumentRef: {},
  // Pagination state
  offset: 0,
  hasMore: true,
  loadingMore: false,
  // Request ID initialization
  loadConversationsRequestId: 0,

  currentConversation: () => {
    const state = get()
    return state.conversations.find(
      (item) => item.id === state.current_conversationid
    ) || {
      id: '',
      title: '',
      create_time: 0,
      update_time: 0,
      top: 0,
      is_valid: 0,
      virtual_id: Date.now().toString()
    }
  },

  setBasePath: (path) => {
    set({ base_path: path || '/chat' })
  },

  setAgentId: (agent_id) => {
    set({ agent_id })
  },

  setDocumentRef: (ref) => {
    set({ currentDocumentRef: ref ?? {} })
  },

  loadConversations: async (signal?: AbortSignal) => {
    const { agent_id, currentDocumentRef } = get()
    if (!agent_id) return []

    // Generate unique request ID for this call
    const requestId = Date.now()
    set({ loadConversationsRequestId: requestId })

    const conversationApi = (await import('@/api/modules/conversation/index')).default
    // 文档引用统一（v0.4.2 §3.2）：仅 document_type + document_id
    const res = await conversationApi.agentList(agent_id, {
      document_type: currentDocumentRef?.documentType,
      document_id: currentDocumentRef?.documentId,
      offset: 0,
      limit: 30,
    })

    // ✅ Race condition check: discard response if stale
    const currentRequestId = get().loadConversationsRequestId
    if (requestId !== currentRequestId) {
      console.log('Discarding stale loadConversations response')
      return []
    }

    // ✅ Check if aborted
    if (signal?.aborted) {
      return []
    }

    const conversations = res.data.items.map((item: any) => ({
      ...item,
      created_date: getSimpleDateFormatString({
        date: item.created_time,
        format: 'YYYY.MM.DD hh:mm'
      }),
      updated_date: getSimpleDateFormatString({
        date: item.updated_time,
        format: 'YYYY.MM.DD hh:mm'
      })
    }))

    set({
      conversations,
      offset: 30,
      hasMore: conversations.length >= 30,
      loadingMore: false
    })
    return conversations
  },

  loadMoreConversations: async () => {
    const { agent_id, currentDocumentRef, offset, hasMore, loadingMore } = get()
    if (!agent_id || !hasMore || loadingMore) return

    set({ loadingMore: true })

    try {
      const conversationApi = (await import('@/api/modules/conversation/index')).default
      // 文档引用统一（v0.4.2 §3.2）：仅 document_type + document_id
      const res = await conversationApi.agentList(agent_id, {
        document_type: currentDocumentRef?.documentType,
        document_id: currentDocumentRef?.documentId,
        offset,
        limit: 30,
      })

      const newConversations = res.data.items.map((item: any) => ({
        ...item,
        created_date: getSimpleDateFormatString({
          date: item.created_time,
          format: 'YYYY.MM.DD hh:mm'
        }),
        updated_date: getSimpleDateFormatString({
          date: item.updated_time,
          format: 'YYYY.MM.DD hh:mm'
        })
      }))

      set(state => {
        // Deduplicate by ID to prevent React key warnings
        const merged = [...state.conversations, ...newConversations]
        const deduped = [...new Map(merged.map(c => [c.id, c])).values()]
        return {
          conversations: deduped,
          offset: state.offset + newConversations.length,
          hasMore: newConversations.length >= 30,
          loadingMore: false
        }
      })
    } catch (error) {
      console.error('Failed to load more conversations:', error)
      set({ loadingMore: false })
    }
  },

  createConversation: async (agent_id, documentRef, title = '') => {
    const conversationApi = (await import('@/api/modules/conversation/index')).default
    // 文档引用统一（v0.4.2 §3.2）：仅 document_type + document_id
    const data: {
      agent_id: string
      title: string
      document_type?: DocumentType
      document_id?: string
    } = { agent_id, title }
    if (documentRef?.documentType && documentRef?.documentId) {
      data.document_type = documentRef.documentType
      data.document_id = documentRef.documentId
    }
    const res = await conversationApi.create(data)
    return res.data
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
    set((state) => {
      // Check if conversation already exists to prevent duplicates
      const exists = state.conversations.some(c => c.id === newConversation.id)
      if (exists) {
        return {
          conversations: state.conversations.map(c =>
            c.id === newConversation.id ? newConversation : c
          )
        }
      }
      return {
        conversations: [newConversation, ...state.conversations]
      }
    })
  },

  updateConversation: (conversation) => {
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === conversation.id ? { ...item, ...conversation } : item
      )
    }))
  },

  editConversation: async (conversation) => {
    const conversationApi = (await import('@/api/modules/conversation/index')).default
    // 文档引用统一（v0.4.2 §3.2）：不再发送 file_id
    const data = { title: conversation.title }
    await conversationApi.edit(conversation.id as number, data)
    get().updateConversation(conversation)
  },

  delConversation: async (conversation) => {
    const conversationApi = (await import('@/api/modules/conversation/index')).default
    const { current_conversationid } = get()

    set((state) => ({
      conversations: state.conversations.filter(
        (item) => item.id !== conversation.id
      )
    }))

    await conversationApi.del(conversation.id)

    if (current_conversationid === conversation.id) {
      get().setCurrentState('')
    }
  },

  updateConversationLatestRun: (conversationId, latestRun) => {
    set((state) => ({
      conversations: state.conversations.map((item) =>
        String(item.id) === String(conversationId) ? { ...item, latest_run: latestRun } : item
      )
    }))
  },

  setCurrentState: (conversation_id, setRouter = true) => {
    // 直接设置 conversation_id，不再检查是否在列表中
    // 这样可以支持 URL 中的 conversation_id 不在第一页数据中的情况
    set({ current_conversationid: conversation_id })

    if (setRouter) {
      get().setRouter({ conversation_id: conversation_id || '' })
    }
  },

  clearCurrentState: () => {
    set({ current_conversationid: '' })
  },

  setRouter: (data: RouterOptions = {}) => {
    const { base_path } = get()
    const url = `${base_path}?${data.conversation_id ? `conversation_id=${data.conversation_id}` : ''}`

    // Check if we're in a chat route to use replaceState
    if (pathIncludes('/chat')) {
      window.history.replaceState(null, '', url)
    } else {
      // Use navigate for other routes
      const navigate = (window as any).__navigate__
      if (navigate) {
        navigate({
          pathname: base_path,
          search: data.conversation_id ? `conversation_id=${data.conversation_id}` : ''
        })
      } else {
        window.history.pushState(null, '', url)
      }
    }
  }
}))
