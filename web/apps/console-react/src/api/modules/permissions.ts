import service from '../config'
import { handleError } from '../error-handler'
import { PermissionType } from '@/components/Permission/constant'

export interface PermissionListRequest {
  resource_type: number
  resource_id?: string
  subject_type?: number
  subject_id?: number
  permission?: number
}

export interface PermissionItem {
  created_time: number
  eid: number
  id: number
  permission: number
  resource_id: number
  resource_type: number
  subject_id: number
  subject_type: number
  updated_time: number
}

export type PermissionListResponse = PermissionItem[]

export interface PermissionCreateRequest {
  permission: {
    subject_type: number
    subject_id: number
    permission: number
  }[]
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
    return service
      .get('/api/permissions', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  update(permission_id: PermissionItem['id'], data: { permission: number }) {
    return service.put(`/api/permissions/${permission_id}`, data).catch(handleError)
  },
  delete(permission_id: PermissionItem['id']) {
    return service.delete(`/api/permissions/${permission_id}`).catch(handleError)
  },
  create(resource_type: number, resource_id: number, data: PermissionCreateRequest) {
    return service.post(`/api/permissions/${resource_type}/${resource_id}`, data).catch(handleError)
  },
  my(params: PermissionMeRequest): Promise<PermissionMeResponse> {
    return service
      .get('/api/permissions/my', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  myBatch(params: PermissionMyBatchRequest): Promise<PermissionMyBatchMap> {
    return service
      .post('/api/permissions/my/batch', params)
      .then((res: any) => buildPermissionBatchMap(res.data?.permissions || []))
      .catch(handleError)
  },
}

export default permissionsApi

