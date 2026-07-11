import { create } from 'zustand'
import { useSettingStore } from './setting'
import { useEnterpriseStore } from './enterprise'
import { ENTERPRISE_SYNC_FROM, type EnterpriseSyncFrom } from '@/constants/enterprise'

const SYNC_VALUE_KEY = 'sso_sync_from'

export type SyncValueState = {
  key: string
  setting_id: number
  value: EnterpriseSyncFrom
}

interface SsoState {
  syncValue: SyncValueState
  isLoading: boolean
  loadSyncSetting: () => Promise<void>
  saveSyncSetting: (value: string) => Promise<void>
}

const defaultSyncValue: SyncValueState = {
  key: SYNC_VALUE_KEY,
  setting_id: 0,
  value: ENTERPRISE_SYNC_FROM.DEFAULT,
}

export const useSsoStore = create<SsoState>((set, get) => ({
  syncValue: defaultSyncValue,
  isLoading: false,

  async loadSyncSetting() {
    // 防抖：正在加载时跳过
    if (get().isLoading) return

    const enterprise = useEnterpriseStore.getState()
    const info = enterprise.info as { is_install_wecom?: boolean; is_install_dingtalk?: boolean }

    // 如果企业信息还没加载完成，不加载
    if (!info.is_install_wecom && !info.is_install_dingtalk) return

    set({ isLoading: true })
    try {
      const settingStore = useSettingStore.getState()
      const value = await settingStore.get(SYNC_VALUE_KEY) as SyncValueState | undefined
      set({
        syncValue: value || defaultSyncValue,
      })
    } finally {
      set({ isLoading: false })
    }
  },

  async saveSyncSetting(value: string) {
    const settingStore = useSettingStore.getState()
    const syncValue = get().syncValue
    const data = await settingStore.save(syncValue.setting_id, {
      value,
      key: SYNC_VALUE_KEY,
    })
    set({
      syncValue: data as SyncValueState,
    })
  },
}))

// Selector hooks
export const useIsSsoSync = () =>
  useSsoStore((state) => state.syncValue.value !== ENTERPRISE_SYNC_FROM.DEFAULT)

export const useSyncValue = () =>
  useSsoStore((state) => state.syncValue)