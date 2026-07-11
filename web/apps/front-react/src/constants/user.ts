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
