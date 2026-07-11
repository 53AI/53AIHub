import { create } from 'zustand'
import service from '@/api/config'

interface SettingsInfo {
  key?: string
  setting_id?: number
  value?: string
  [key: string]: unknown
}

interface SettingState {
  loadListData: () => Promise<SettingsInfo[]>
  get: (key: string) => Promise<unknown>
  loadDetailData: (group_name: string) => Promise<unknown[]>
  save: (setting_id: number, data: { key: string; value: string }) => Promise<SettingsInfo>
}

export const useSettingStore = create<SettingState>(() => ({
  async loadListData() {
    try {
      const res = await service.get('/api/settings')
      const data = (res as { data?: unknown[] })?.data
      return Array.isArray(data) ? data as SettingsInfo[] : []
    } catch {
      return []
    }
  },

  async get(key: string) {
    try {
      const res = await service.get(`/api/settings/key/${key}`)
      return (res as { data?: unknown })?.data
    } catch {
      return undefined
    }
  },

  async loadDetailData(group_name: string) {
    try {
      const res = await service.get(`/api/settings/group/${group_name}`)
      const data = (res as { data?: unknown[] })?.data
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  },

  async save(setting_id: number, data: { key: string; value: string }) {
    if (setting_id) {
      const res = await service.put(`/api/settings/${setting_id}`, data)
      return (res as { data?: SettingsInfo })?.data ?? { setting_id, key: data.key, value: data.value }
    }
    const res = await service.post('/api/settings', data)
    return (res as { data?: SettingsInfo })?.data ?? { setting_id: 0, key: data.key, value: data.value }
  },
}))
