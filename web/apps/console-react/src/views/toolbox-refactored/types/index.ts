/**
 * Toolbox 模块类型定义
 * 集中管理所有类型，便于复用和测试
 */

/**
 * AI 工具项
 */
export interface AiLinkItem {
  ai_link_id: string
  name: string
  description: string
  logo: string
  url: string
  group_id: number
  sort: number
  shared_account?: string
  user_group_ids?: number[]
  subscription_group_ids?: number[]
}

/**
 * 分组选项
 */
export interface GroupOption {
  group_id: string | number
  group_name: string
  children: AiLinkItem[]
}

/**
 * 共享账号项
 */
export interface SharedAccountItem {
  account: string
  password: string
  remark?: string
}

/**
 * 商店分类项
 */
export interface StoreItem {
  group_id: number
  group_name: string
  links: AiLinkItem[]
}

/**
 * 筛选表单
 */
export interface FilterForm {
  group_id: (string | number)[]
  keyword: string
}

/**
 * AI 工具详情（用于创建/编辑）
 */
export interface AiLinkDetail {
  ai_link_id?: string
  id?: string
  logo?: string
  name?: string
  url?: string
  description?: string
  group_id?: number
  sort?: number
  shared_account?: string
  user_group_ids?: number[]
  subscription_group_ids?: number[]
}

/**
 * 排序项
 */
export interface SortItem {
  group_id: number
  id: string
  sort: number
}

/**
 * 分组变更载荷
 */
export interface GroupChangePayload {
  groupType: number
  data: number[]
}

/**
 * 创建页面参数
 */
export interface CreatePageParams {
  id?: string
  name?: string
}

/**
 * 商店对话框引用方法
 */
export interface StoreDialogRef {
  open: () => void
  close: () => void
}

/**
 * API 分组响应项（groupApi.list 返回）
 */
export interface GroupApiResponse {
  group_id: number
  group_name: string
  sort?: number
}

/**
 * 原始分组选项（用于 GroupTabs 组件，与 Group 类型一致）
 */
export interface RawGroupOption {
  group_id: number
  group_name: string
  sort: number
}

/**
 * AI 工具列表 API 请求参数
 */
export interface AiLinkListParams {
  group_id?: number[]
  keyword?: string
}

/**
 * AI 工具列表 API 响应
 */
export interface AiLinkListResponse {
  list: AiLinkItem[]
  total?: number
}
