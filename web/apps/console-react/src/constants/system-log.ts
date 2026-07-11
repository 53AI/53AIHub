export const SYSTEM_LOG_ACTION = {
  LOGIN: 5,
  LOGOUT: 5,
} as const

export type SystemLogAction = (typeof SYSTEM_LOG_ACTION)[keyof typeof SYSTEM_LOG_ACTION]

