import { STORAGE_KEYS, type StorageKey } from '@/constants/storage'

/**
 * 提醒数据结构
 */
export interface ReminderData {
  date: string
  value: any
}

/**
 * Storage 工具对象
 * 提供通用的 localStorage 操作方法
 */
export const storageManager = {
  /**
   * 设置 localStorage 项
   */
  setItem<T>(key: StorageKey | string, value: T): void {
    try {
      const serializedValue = JSON.stringify(value)
      localStorage.setItem(key, serializedValue)
    } catch (error) {
      console.error('Failed to set localStorage item:', error)
    }
  },

  /**
   * 获取 localStorage 项
   */
  getItem<T>(key: StorageKey | string): T | null {
    try {
      const value = localStorage.getItem(key)
      return value ? JSON.parse(value) : null
    } catch (error) {
      console.error('Failed to get localStorage item:', error)
      return null
    }
  },

  /**
   * 删除 localStorage 项
   */
  removeItem(key: StorageKey | string): void {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error('Failed to remove localStorage item:', error)
    }
  },

  /**
   * 清空 localStorage
   */
  clear(): void {
    try {
      localStorage.clear()
    } catch (error) {
      console.error('Failed to clear localStorage:', error)
    }
  },

  /**
   * 检查 localStorage 中是否存在某个键
   */
  hasItem(key: StorageKey | string): boolean {
    try {
      return localStorage.getItem(key) !== null
    } catch (error) {
      console.error('Failed to check localStorage item:', error)
      return false
    }
  },

  /**
   * 检查是否需要显示提醒（通用方法）
   * @param key 存储键
   * @param currentValue 当前值
   * @param checkDaily 是否按日检查（默认 true）
   */
  shouldShowReminder(
    key: StorageKey | string,
    currentValue: any,
    checkDaily: boolean = true
  ): boolean {
    const storedData = storageManager.getItem<ReminderData>(key)

    if (!storedData) return true

    // 如果需要按日检查
    if (checkDaily) {
      const today = new Date().toDateString()
      // 如果是新的一天或者值发生变化，则允许显示提醒
      return storedData.date !== today || storedData.value !== currentValue
    }

    // 如果不按日检查，只检查值是否变化
    return storedData.value !== currentValue
  },

  /**
   * 记录已显示提醒（通用方法）
   * @param key 存储键
   * @param value 要记录的值
   * @param withDate 是否记录日期（默认 true）
   */
  recordReminderShown(key: StorageKey | string, value: any, withDate: boolean = true): void {
    const data: ReminderData = {
      date: withDate ? new Date().toDateString() : '',
      value
    }
    storageManager.setItem(key, data)
  },

  /**
   * 获取上次提醒记录
   */
  getLastReminderRecord(key: StorageKey | string): ReminderData | null {
    return storageManager.getItem<ReminderData>(key)
  }
}

// 导出便捷方法
export const {
  setItem,
  getItem,
  removeItem,
  clear,
  hasItem,
  shouldShowReminder,
  recordReminderShown,
  getLastReminderRecord
} = storageManager

// 导出 STORAGE_KEYS 常量供外部使用
export { STORAGE_KEYS }
