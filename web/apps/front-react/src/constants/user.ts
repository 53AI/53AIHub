import { getPublicPath } from "@/utils"
export const USER_ROLES = {
  ADMIN: 2,
  MEMBER: 1,
  GUEST: 0,
} as const

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES]

export const USER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 0,
} as const

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS]

/**
 * 用户默认头像
 *
 * API / 分享数据返回的 avatar 字段可能为空或加载失败，统一回退到此图。
 */
export const DEFAULT_USER_AVATAR = getPublicPath('/images/default_avatar.png')
