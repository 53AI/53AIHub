import { useState, useCallback, useMemo } from 'react'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import { settingApi } from '@/api/modules/setting'
import { ENTERPRISE_SYNC_FROM, type EnterpriseSyncFrom } from '@/constants/enterprise'

const SYNC_VALUE_KEY = 'sso_sync_from'

// 简单的内存缓存
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

const getFromCache = <T>(key: string): T | null => {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T
  }
  return null
}

const setCache = (key: string, data: unknown) => {
  cache.set(key, { data, timestamp: Date.now() })
}

const deleteCache = (key: string) => {
  cache.delete(key)
}

interface SyncValue {
  key: string
  setting_id: number
  value: EnterpriseSyncFrom
}

export const useSso = () => {
  const enterprise = useEnterpriseStore()
  const isInstallWecom = enterprise.is_install_wecom

  const [syncValue, setSyncValue] = useState<SyncValue>({
    key: SYNC_VALUE_KEY,
    setting_id: 0,
    value: ENTERPRISE_SYNC_FROM.DEFAULT
  })

  const loadSyncSetting = useCallback(async () => {
    if (!isInstallWecom) return

    // 检查缓存
    const cached = getFromCache<SyncValue>(SYNC_VALUE_KEY)
    if (cached) {
      setSyncValue(cached)
      return
    }

    try {
      const value = await settingApi.get(SYNC_VALUE_KEY)
      const data: SyncValue = value || {
        key: SYNC_VALUE_KEY,
        setting_id: 0,
        value: ENTERPRISE_SYNC_FROM.DEFAULT
      }
      setCache(SYNC_VALUE_KEY, data)
      setSyncValue(data)
    } catch (error) {
      console.error('获取 SSO 同步设置失败:', error)
    }
  }, [isInstallWecom])

  const saveSyncSetting = useCallback(async (value: string) => {
    try {
      const data = await settingApi.update(syncValue.setting_id, {
        value,
        key: SYNC_VALUE_KEY
      })
      deleteCache(SYNC_VALUE_KEY)
      setSyncValue(data as unknown as SyncValue)
    } catch (error) {
      console.error('保存 SSO 同步设置失败:', error)
    }
  }, [syncValue.setting_id])

  const isSsoSync = useMemo(
    () => syncValue.value !== ENTERPRISE_SYNC_FROM.DEFAULT,
    [syncValue.value]
  )

  return {
    syncValue,
    isSsoSync,
    loadSyncSetting,
    saveSyncSetting
  }
}

export default useSso
