import { create } from 'zustand'
import { useBasicLayout } from '@/hooks/useBasicLayout'

interface GlobalState {
  siderVisible: boolean
  siderCollapsed: boolean
  toggleSider: () => void
  hoverSider: (visible: boolean) => void
  setSiderVisible: (visible: boolean) => void
  setSiderCollapsed: (collapsed: boolean) => void
}

export const useGlobalStore = create<GlobalState>((set, get) => ({
  siderVisible: true,
  siderCollapsed: false,

  toggleSider: () => {
    const { siderVisible, siderCollapsed } = get()
    // Check if medium screen (simplified check)
    const isMdScreen = window.innerWidth < 768

    if (isMdScreen) {
      set({ siderCollapsed: !siderCollapsed })
      return
    }

    const newVisible = !siderVisible
    set({
      siderVisible: newVisible,
      siderCollapsed: newVisible ? false : siderCollapsed
    })
  },

  hoverSider: (visible: boolean) => {
    const { siderVisible } = get()
    const isMdScreen = window.innerWidth < 768

    if (isMdScreen && !visible) {
      return
    }

    if (!siderVisible) {
      set({ siderCollapsed: visible })
    }
  },

  setSiderVisible: (visible: boolean) => {
    set({ siderVisible: visible })
  },

  setSiderCollapsed: (collapsed: boolean) => {
    set({ siderCollapsed: collapsed })
  },
}))
