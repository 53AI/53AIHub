// 实体类型
export type EntityType = 'user' | 'group'

export const ENTITY_TYPE = {
  USER: 'user',
  GROUP: 'group',
} as const

// 用户信息
export interface UserInfo {
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
  value: number
  label: string
}

// 群组信息
export interface GroupInfo {
  group_id: number
  group_name: string
  sort: number
  value: number
  label: string
  avatar?: string
}

// 实体信息联合类型
export type EntityInfo = UserInfo | GroupInfo
