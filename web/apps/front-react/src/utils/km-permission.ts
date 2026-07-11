import { PERMISSION_TYPE } from '@/components/KMPermission/constant'
import type { PermissionType } from '@/components/KMPermission/constant'


// 权限检查结果
export interface PermissionCheckResult {
  hasPermission: boolean
  message: string
}

/**
 * 检查用户是否有指定权限
 * @param permission 用户当前权限级别
 * @param requiredPermission 要求的权限级别
 * @returns 权限检查结果
 */
export function checkKMPermission(permission: PermissionType, requiredPermission: PermissionType): PermissionCheckResult {
  // 权限级别从高到低：manager(500) > edit_all(400) > edit_knowledge(300) > view_and_export(200) > viewer(100) > public_only(1) > none(0)

  // 如果用户权限大于等于要求的权限，则有权限
  if (permission >= requiredPermission) {
    return { hasPermission: true, message: '' }
  }

  // 根据要求的权限级别返回对应的提示信息
  switch (requiredPermission) {
    case PERMISSION_TYPE.manage:
      return {
        hasPermission: false,
        message: '需要管理权限'
      }
    case PERMISSION_TYPE.edit_all:
      return {
        hasPermission: false,
        message: '需要可编辑知识&语料权限'
      }
    case PERMISSION_TYPE.edit_knowledge:
      return {
        hasPermission: false,
        message: '需要可编辑知识权限'
      }
    case PERMISSION_TYPE.view_and_export:
      return {
        hasPermission: false,
        message: '需要查看/导出权限'
      }
    case PERMISSION_TYPE.viewer:
      return {
        hasPermission: false,
        message: '需要查看权限'
      }
    case PERMISSION_TYPE.public_only:
      return {
        hasPermission: false,
        message: '需要查看权限'
      }
    default:
      return {
        hasPermission: false,
        message: '需要查看权限'
      }
  }
}

export function checkHasKMPermission(permission: PermissionType, requiredPermission: PermissionType): boolean {
  return checkKMPermission(permission, requiredPermission).hasPermission
}
