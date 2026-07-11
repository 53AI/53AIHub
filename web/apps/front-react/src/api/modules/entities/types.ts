/**
 * 实体类型定义
 */
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

/**
 * 实体类型列表响应
 */
export type EntityTypesResponse = Record<EntityType, string>

/**
 * 实体状态
 */
export type EntityStatus = 'active' | 'inactive'

/**
 * 原始实体数据
 */
export interface RawEntity {
  id: string
  eid: number
  type: EntityType
  name: string
  status: EntityStatus
  created_time: number
  updated_time: number
}

/**
 * 实体列表查询参数
 */
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

/**
 * 实体列表响应
 */
export interface EntityListResponse {
  items: RawEntity[]
  total: number
  offset: number
  limit: number
}

/**
 * 创建实体请求参数
 */
export interface CreateEntityParams {
  type: EntityType
  name: string
  status?: EntityStatus
}

/**
 * 更新实体请求参数
 */
export interface UpdateEntityParams {
  type?: EntityType
  name?: string
  status?: EntityStatus
}

/**
 * 批量关联实体项
 */
export interface BatchLinkEntityItem {
  file_id?: string
  chunk_id?: string
  library_id?: string
  type: EntityType
  name: string
}

/**
 * 批量关联实体请求参数
 */
export interface BatchLinkEntityParams {
  items: BatchLinkEntityItem[]
}
