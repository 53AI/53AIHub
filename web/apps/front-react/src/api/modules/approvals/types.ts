import { PermissionType, ResourceType } from "@/components/KMPermission/constant"

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
