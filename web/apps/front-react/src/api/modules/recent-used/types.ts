/** 资源类型：0=空间, 1=知识库, 2=文件, 3=Wiki 页面 */
export type RecentUsedResourceType = 0 | 1 | 2 | 3

/** 保存最近使用记录请求（单条） */
export interface RecentUsedSaveItem {
  resource_type: RecentUsedResourceType
  resource_id: string
  /** Wiki 页面（resource_type=3）时必填；其他类型不传 */
  space_id?: string
}

/** 最近使用记录响应项 */
export interface RecentUsedItem {
  id: string
  resource_type: RecentUsedResourceType
  resource_id: string
  name: string
  icon?: string
  path: string
  /** Wiki 页面（resource_type=3）专用，定位页面用 */
  slug?: string
  file_type?: string
  is_dir?: boolean
  library_id?: string
  library_name?: string
  space_id?: string
  space_name?: string
  updated_time: number
}

/** 最近使用列表查询参数 */
export interface RecentUsedListParams {
  /** 资源类型筛选：0=空间, 1=知识库, 2=文件, 3=Wiki 页面 */
  resource_type?: RecentUsedResourceType
  /** 空间ID（支持 Hashids 或原始数字ID） */
  space_id?: string
}
