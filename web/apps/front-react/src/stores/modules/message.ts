import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface MessageItem {
  id: string
  title: string
  content: string
  type: 'info' | 'success' | 'warning' | 'error'
  read: boolean
  createdAt: string
  link?: string
}

interface MessageState {
  messages: MessageItem[]
  loading: boolean
  error: string | null
}

interface MessageActions {
  fetchMessages: () => Promise<void>
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearMessages: () => void
  addMessage: (message: Omit<MessageItem, 'id' | 'read' | 'createdAt'>) => void
  removeMessage: (id: string) => void
}

type MessageStore = MessageState & MessageActions

export const useMessageStore = create<MessageStore>()(
  devtools(
    (set, get) => ({
      messages: [],
      loading: false,
      error: null,

      fetchMessages: async () => {
        set({ loading: true, error: null })
        try {
          // TODO: Replace with actual API call
          const response = await fetch('/api/messages')
          const data = await response.json()
          set({ messages: data, loading: false })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch messages',
            loading: false
          })
        }
      },

      markAsRead: (id: string) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, read: true } : msg
          )
        }))
      },

      markAllAsRead: () => {
        set((state) => ({
          messages: state.messages.map((msg) => ({ ...msg, read: true }))
        }))
      },

      clearMessages: () => {
        set({ messages: [] })
      },

      addMessage: (message) => {
        const newMessage: MessageItem = {
          ...message,
          id: Date.now().toString(),
          read: false,
          createdAt: new Date().toISOString()
        }
        set((state) => ({
          messages: [newMessage, ...state.messages]
        }))
      },

      removeMessage: (id: string) => {
        set((state) => ({
          messages: state.messages.filter((msg) => msg.id !== id)
        }))
      }
    }),
    {
      name: 'message-store'
    }
  )
)
