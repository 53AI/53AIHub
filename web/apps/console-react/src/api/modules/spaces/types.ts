export interface SpaceItem {
  id: string
  eid: number
  name: string
  description: string
  icon: string
  owner_id: number
  sort: number
  status: number
  library_count: number
  is_default: boolean
  created_time: number
  updated_time: number
  visibility: number
  owner_info: {
    nickname: string
  }
  enable_wiki_knowledge_graph?: boolean
  enable_wiki_dynamic_knowledge?: boolean
}

export interface SpaceListRequest {
  offset: number
  limit: number
  name?: string
  view?: 'admin' | 'user'
}

export interface SpaceListResponse {
  spaces: SpaceItem[]
  count: number
}

export interface SpaceCreateRequest {
  name: string
  description: string
  icon: string
  visibility: number
  permissions: {
    subject_type: number
    subject_id: number
    permission: number
  }[]
  enable_wiki_knowledge_graph?: boolean
  enable_wiki_dynamic_knowledge?: boolean
}

export interface SpaceDisplayItem extends Omit<SpaceItem, 'created_time' | 'updated_time'> {
  created_time: string
  updated_time: string
}

export interface SpacePermissionItem {
  id: number
  eid: number
  resource_type: number
  resource_id: number
  subject_type: number
  subject_id: number
  permission: number
  created_time: number
  updated_time: number
}

/**
 * 空间回收站条目（后端字段未就绪时先用占位结构）
 * TODO: 后端就绪后, 按实际返回字段调整
 */
export interface SpaceRecycleItem {
  id: string
  name: string
  space_id: string
  library_id?: string
  deleted_time?: number
  deleted_by?: string
  size?: number
}

export interface SpaceRecycleListRequest {
  space_id: SpaceItem['id']
  keyword?: string
  offset?: number
  limit?: number
}

export interface SpaceRecycleListResponse {
  items: SpaceRecycleItem[]
  count: number
}

