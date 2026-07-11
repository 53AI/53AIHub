export const STORAGE_KEYS = {
  // 过期提醒相关
  EXPIRE_REMINDER: 'expire_reminder_shown'
} as const

export const STORAGE_CONFIG = {
  // 最小过期天数
  MIN_EXPIRE_DAY: 30
} as const

// 导出存储键名类型
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
