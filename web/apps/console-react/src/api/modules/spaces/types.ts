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

