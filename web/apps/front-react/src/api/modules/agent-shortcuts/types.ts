/**
 * 智能体快捷方式相关类型定义
 */

/** 快捷方式项 */
export interface AgentShortcutItem {
  id: number
  agent_id: string
  is_pinned: boolean
  last_message_time: number
  last_message_content: string
  agent_name: string
  agent_logo: string
  agent_description: string
  agent_usage: number
  channel_type: number
  created_time: number
  updated_time: number
}

/** 添加快捷方式请求 */
export interface AgentShortcutCreateRequest {
  agent_id: string
}

/** API 响应格式 */
export interface AgentShortcutListResponse {
  code: number
  msg: string
  data: AgentShortcutItem[]
}

export interface AgentShortcutCreateResponse {
  code: number
  msg: string
  data: AgentShortcutItem
}
