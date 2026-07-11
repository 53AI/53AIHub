/**
 * System Log 模块类型定义
 * 集中管理所有类型，便于复用和测试
 */

/**
 * 系统日志项（API 响应）
 */
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

/**
 * 系统日志展示项（带格式化时间）
 */
export interface SystemLogDisplayItem extends Omit<SystemLogItem, 'action_time'> {
  action_time: string
}

/**
 * 操作项（下拉选项）
 */
export interface ActionItem {
  value: number
  text: string
}

/**
 * 模块项（下拉选项）
 */
export interface ModuleItem {
  value: number
  text: string
}

/**
 * 列表请求参数
 */
export interface SystemLogListParams {
  offset: number
  limit: number
  user_id?: string | null
  start_time?: number | null
  end_time?: number | null
  module?: number
  action?: number
}

/**
 * 列表响应
 */
export interface SystemLogListResponse {
  system_logs: SystemLogItem[]
  count: number
}

/**
 * 创建日志请求
 */
export interface SystemLogCreateRequest {
  action: number
  content: string
}

/**
 * 日期范围
 */
export interface DateRange {
  start: number | null
  end: number | null
}

/**
 * 分页状态
 */
export interface PaginationState {
  current: number
  pageSize: number
  total: number
}
