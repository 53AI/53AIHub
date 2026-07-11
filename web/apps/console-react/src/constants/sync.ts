export const SYNC_FROM = {
  DEFAULT: '0' as const,
  WECOM: '1' as const,
} as const

export const SYNC_FROM_NUMBER = {
  DEFAULT: 0 as const,
  WECOM: 1 as const,
} as const

export type SyncFrom = (typeof SYNC_FROM)[keyof typeof SYNC_FROM]
export type SyncFromNumber = (typeof SYNC_FROM_NUMBER)[keyof typeof SYNC_FROM_NUMBER]

