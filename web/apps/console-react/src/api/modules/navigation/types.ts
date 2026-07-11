import type { NavigationType, NavigationTarget } from '@/constants/navigation'

/**
 * 导航项配置
 */
export interface NavigationConfig {
  target: NavigationTarget
  seo_title: string
  seo_keywords: string
  seo_description: string
  agent_id?: number
  agent_class_id?: number
}

/**
 * 导航项（转换后的数据）
 */
export interface NavigationItem {
  id: number
  navigation_id: number
  type: NavigationType
  type_label?: string
  name: string
  jump_path: string
  sort: number
  status: 0 | 1
  target: NavigationTarget
  target_label?: string
  config: NavigationConfig
  created_at?: string
  icon?: string
}

/**
 * 原始导航项（从 API 返回）
 */
export interface RawNavigationItem {
  id: number
  navigation_id: number
  type: number | string
  name: string
  jump_path: string
  sort: number
  status: 0 | 1
  target?: number | string
  config: string | object
  created_at?: string
  updated_at?: string
  icon?: string
}

/**
 * 导航列表查询参数
 */
export interface NavigationListParams {
  keyword?: string
  offset?: number
  limit?: number
}

/**
 * 导航列表响应
 */
export interface NavigationListResponse {
  total: number
  list: NavigationItem[]
}

/**
 * 创建导航数据
 */
export interface CreateNavigationData {
  type: NavigationType
  name: string
  jump_path: string
  sort: number
  config: NavigationConfig
  icon: string
}

/**
 * 更新导航数据
 */
export interface UpdateNavigationData extends CreateNavigationData {
  navigation_id: string
}

/**
 * 更新导航状态数据
 */
export interface UpdateNavigationStatusData {
  navigation_id: number
  status: 0 | 1
}

/**
 * 更新导航排序数据
 */
export type UpdateNavigationSortData = {
  id: number
  sort: number
}[]

/**
 * 保存导航内容数据
 */
export interface SaveNavigationContentData {
  navigation_id: number
  html_content: string
}

