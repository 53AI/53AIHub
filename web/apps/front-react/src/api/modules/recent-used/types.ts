/** 资源类型：0=空间, 1=知识库, 2=文件 */
export type RecentUsedResourceType = 0 | 1 | 2

/** 保存最近使用记录请求（单条） */
export interface RecentUsedSaveItem {
  resource_type: RecentUsedResourceType
  resource_id: number
}

/** 最近使用记录响应项 */
export interface RecentUsedItem {
  id: string
  resource_type: RecentUsedResourceType
  resource_id: string
  name: string
  icon?: string
  path: string
  file_type?: string
  is_dir?: boolean
  library_id?: string
  library_name?: string
  space_name?: string
  updated_time: number
}
