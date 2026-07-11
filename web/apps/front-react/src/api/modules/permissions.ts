import request from '../index'
import { handleError } from '../errorHandler'
import type { PermissionType } from '@/components/KMPermission/constant'

export interface PermissionListRequest {
  resource_type: number
  resource_id?: string
  subject_type?: number
  subject_id?: number
  permission?: number
}

export interface PermissionItem {
  created_time: number,
  eid: string,
  id: number,
  permission: number,
  resource_id: string,
  resource_type: number,
  subject_id: number,
  subject_type: number,
  updated_time: number
}
export type PermissionListResponse = PermissionItem[]

export interface PermissionCreateRequest {
  permissions: {
    subject_type: number
    subject_id: number
    permission: number
  }[]
}

export interface PermissionGetRequest {
  resource_type: number
  resource_id: string
}

export interface PermissionDetailResponse {
  // 当前层级
  direct: PermissionItem[]
  resource_id: string
  resource_type: number
  // 上一级管理员
  team_admin: PermissionItem[]
  // 上一级成员
  team_member: PermissionItem[]
}

export interface PermissionMeRequest {
  resource_type: number
  resource_id: string
}

export interface PermissionMeResponse {
  max_permission: PermissionType
  resource_id: string
  resource_type: number
}

export interface PermissionMyBatchRequest {
  resource_type: number
  resource_ids: string[]
}

export interface PermissionMyBatchItem {
  max_permission: PermissionType
  resource_id: string
  resource_type: number
}

export type PermissionMyBatchMap = Record<string, PermissionType>

const buildPermissionBatchMap = (permissions: PermissionMyBatchItem[]): PermissionMyBatchMap => {
  return permissions.reduce<PermissionMyBatchMap>((map, item) => {
    map[`${item.resource_type}:${item.resource_id}`] = item.max_permission
    return map
  }, {})
}

export const permissionsApi = {
  list(params: PermissionListRequest): Promise<PermissionListResponse> {
    return request
      .get('/api/permissions', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  update(permission_id: PermissionItem['id'], data: { permission: number }): Promise<void> {
    return request.put(`/api/permissions/${permission_id}`, data).catch(handleError)
  },
  delete(permission_id: PermissionItem['id']): Promise<void> {
    return request.delete(`/api/permissions/${permission_id}`).catch(handleError)
  },
  create(resource_type: number, resource_id: string, data: PermissionCreateRequest): Promise<void> {
    return request.post(`/api/permissions/${resource_type}/${resource_id}`, data).catch(handleError)
  },
  detail(params: PermissionGetRequest): Promise<PermissionDetailResponse> {
    return request.get(`/api/permissions/detail`, { params }).then((res: any) => res.data).catch(handleError)
  },
  my(params: PermissionMeRequest): Promise<PermissionMeResponse> {
    return request.get(`/api/permissions/my`, { params }).then((res: any) => res.data).catch(handleError)
  },
  myBatch(data: PermissionMyBatchRequest): Promise<PermissionMyBatchMap> {
    return request
      .post('/api/permissions/my/batch', data)
      .then((res: any) => buildPermissionBatchMap(res.data?.permissions || []))
      .catch(handleError)
  }
}

export default permissionsApi
