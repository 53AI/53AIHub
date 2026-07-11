import type { SystemLogAction } from '@/constants/system-log'

export interface SystemLogItem {
  id: number
  eid: number
  user_id: number
  nickname: string
  module: number
  action: number
  content: string
  ip: string
  action_time: number
}

export interface SystemLogListResponse {
  system_logs: SystemLogItem[]
  count: number
}

export interface SystemLogListRequest {
  offset: number
  limit: number
  user_id?: string | null
  start_time?: number | null
  end_time?: number | null
  module?: number
  action?: number
}

export interface SystemLogCreateRequest {
  action: SystemLogAction
  content: string
}

export interface ActionItem {
  value: number
  text: string
}

export interface ModuleItem {
  value: number
  text: string
}

export interface SystemLogDisplayItem extends Omit<SystemLogItem, 'action_time'> {
  action_time: string
}

