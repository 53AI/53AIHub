import { PERMISSION_TYPE, type PermissionType } from '@/constants/kmPermission'

export interface PermissionCheckResult {
  hasPermission: boolean
  message: string
}

export function checkKMPermission(
  permission: PermissionType,
  requiredPermission: PermissionType,
): PermissionCheckResult {
  if (permission >= requiredPermission) {
    return { hasPermission: true, message: '' }
  }
  switch (requiredPermission) {
    case PERMISSION_TYPE.manage:
      return { hasPermission: false, message: '需要管理权限' }
    case PERMISSION_TYPE.edit_all:
      return { hasPermission: false, message: '需要可编辑知识&语料权限' }
    case PERMISSION_TYPE.edit_knowledge:
      return { hasPermission: false, message: '需要可编辑知识权限' }
    case PERMISSION_TYPE.view_and_export:
      return { hasPermission: false, message: '需要查看/导出权限' }
    case PERMISSION_TYPE.viewer:
    case PERMISSION_TYPE.public_only:
    default:
      return { hasPermission: false, message: '需要查看权限' }
  }
}

export function checkHasKMPermission(
  permission: PermissionType,
  requiredPermission: PermissionType,
): boolean {
  return checkKMPermission(permission, requiredPermission).hasPermission
}
