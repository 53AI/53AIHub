import { create } from 'zustand'

interface KnowledgeAssistantState {
  visible: boolean
  collapsed: boolean
  assistantInstall: boolean  // 是否配置了 agent

  setVisible: (visible: boolean) => void
  setCollapsed: (collapsed: boolean) => void
  setAssistantInstall: (install: boolean) => void
  toggle: () => void
}

export const useKnowledgeAssistantStore = create<KnowledgeAssistantState>((set, get) => ({
  visible: false,
  collapsed: true, // 默认折叠状态（452px）
  assistantInstall: false,

  setVisible: (visible) => set({ visible }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setAssistantInstall: (assistantInstall) => set({ assistantInstall }),
  toggle: () => {
    const { visible, collapsed } = get()
    if (!visible) {
      // 打开面板
      set({ visible: true, collapsed: true })
    } else if (collapsed) {
      // 已折叠状态，关闭面板
      set({ visible: false })
    } else {
      // 已展开状态，折叠
      set({ collapsed: true })
    }
  },
}))