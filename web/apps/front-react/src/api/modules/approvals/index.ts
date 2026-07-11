import request from '../../index'
import { PermissionType, ResourceType } from '@/components/KMPermission/constant'

export interface ApprovalCreateParams {
  permission: PermissionType
  resource: any
  reason: string
  resource_id: string
  resource_type: ResourceType
}

export interface ApprovalCreateResponse {
  id: number
}

export interface ApprovalLastestPendingParams {
  resource_type: ResourceType
  resource_id: string
}

export interface ApprovalLastestPendingResponse {
  pending: boolean
}

const approvalsApi = {
  create(data: ApprovalCreateParams): Promise<ApprovalCreateResponse> {
    return request.post('/api/approvals', data).then((res) => res.data)
  },

  approve(id: number, data: { permission: PermissionType }): Promise<void> {
    return request.post(`/api/approvals/${id}/approve`, data).then((res) => res.data)
  },

  reject(id: number): Promise<void> {
    return request.post(`/api/approvals/${id}/reject`).then((res) => res.data)
  },

  latest_pending(params: ApprovalLastestPendingParams): Promise<ApprovalLastestPendingResponse> {
    return request.get('/api/approvals/latest-pending', { params }).then((res) => res.data)
  }
}

export default approvalsApi
