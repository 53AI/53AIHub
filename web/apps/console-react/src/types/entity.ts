/**
 * 实体类型枚举
 */
export const ENTITY_TYPE = {
  USER: 'user',
  GROUP: 'group',
} as const

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE]

/**
 * 基础实体接口
 */
export interface BaseEntity {
  value: number
  label: string
}

/**
 * 用户信息类型定义
 */
export interface UserInfo extends BaseEntity {
  user_id: number
  nickname: string
  name: string
  avatar: string
  email: string
  mobile: string
  role: number
  status: number
  departments: unknown[]
  created_time: number
}

/**
 * 群组信息类型定义
 */
export interface GroupInfo extends BaseEntity {
  group_id: number
  group_name: string
  sort: number
  avatar?: string
}

/**
 * 统一实体类型
 */
export type EntityInfo = UserInfo | GroupInfo

/**
 * 实体显示配置
 */
export interface EntityDisplayConfig {
  type: EntityType
  id: number | string
  mode: 'avatar' | 'name' | 'full'
  avatarSize?: number | string
  avatarShape?: 'circle' | 'square'
  showLoading?: boolean
  defaultAvatar?: string
}

/**
 * 实体缓存配置
 */
export interface EntityCacheConfig {
  duration: number
  keyPrefix: string
}

/**
 * 实体API参数类型
 */
export interface EntityApiParams {
  user: {
    status: number
    offset: number
    limit: number
  }
  group: {
    group_type: number
  }
}
