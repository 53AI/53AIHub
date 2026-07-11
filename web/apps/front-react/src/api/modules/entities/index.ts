import request from '../../index'

export type EntityType =
  | 'Concept'
  | 'Document'
  | 'Event'
  | 'Location'
  | 'Method'
  | 'Organization'
  | 'Person'
  | 'Product'
  | 'Time'
  | ''

export type EntityTypesResponse = Record<EntityType, string>

export type EntityStatus = 'active' | 'inactive'

export interface RawEntity {
  id: string
  eid: number
  type: EntityType
  name: string
  status: EntityStatus
  created_time: number
  updated_time: number
}

export interface EntityListParams {
  offset?: number
  limit?: number
  keyword?: string
  type?: EntityType
  status?: EntityStatus
  file_id?: string
  chunk_id?: string
  library_id?: string
}

export interface EntityListResponse {
  items: RawEntity[]
  total: number
  offset: number
  limit: number
}

export interface CreateEntityParams {
  type: EntityType
  name: string
  status?: EntityStatus
}

export interface UpdateEntityParams {
  type?: EntityType
  name?: string
  status?: EntityStatus
}

export interface BatchLinkEntityItem {
  file_id?: string
  chunk_id?: string
  library_id?: string
  type: EntityType
  name: string
}

export interface BatchLinkEntityParams {
  items: BatchLinkEntityItem[]
}

export const entitiesApi = {
  getTypes(): Promise<EntityTypesResponse> {
    return request.get('/api/entities/types').then((res) => res.data)
  },

  list(params?: EntityListParams): Promise<EntityListResponse> {
    return request.get('/api/entities', { params }).then((res) => res.data)
  },

  listByFileId(file_id: string): Promise<RawEntity[]> {
    return request.get(`/api/files/${file_id}/entities`).then((res) => res.data)
  },

  get(id: string): Promise<RawEntity> {
    return request.get(`/api/entities/${id}`).then((res) => res.data)
  },

  create(data: CreateEntityParams): Promise<RawEntity> {
    return request.post('/api/entities', data).then((res) => res.data)
  },

  createByFileId(file_id: string, data: CreateEntityParams): Promise<RawEntity> {
    return request.post(`/api/files/${file_id}/entities`, data).then((res) => res.data)
  },

  batchLink(data: BatchLinkEntityParams): Promise<void> {
    return request.post('/api/entities/batch-link', data).then((res) => res.data)
  },

  update(id: string, data: UpdateEntityParams): Promise<RawEntity> {
    return request.put(`/api/entities/${id}`, data).then((res) => res.data)
  },

  delete(id: string): Promise<void> {
    return request.delete(`/api/entities/${id}`).then((res) => res.data)
  }
}

export default entitiesApi
