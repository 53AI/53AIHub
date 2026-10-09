/**
 * Permission utility functions for agent-plugin
 * 对齐 front-react 权限规范（参考 apps/front-react/src/views/prompt）：
 * - SSO 登录（内部用户身份绑定）走 /api/resource-scopes/check 后端资源权限检测
 * - 外部用户走前端分组判断（旧逻辑）
 * - H5 访客（指纹登录）不检查权限，由调用方（views/chat）通过 isSsoLogin 门槛控制
 */
import { message } from 'antd'
import { useUserStore } from '../stores/user'
import request from './request'
import { tApp } from '../i18n'

export type ResourceType = 'agent' | 'space' | 'library' | 'prompt' | 'ai_link' | 'skill_library'

export interface AuthOptions {
  /** 检测是不是登录 */
  checkLogin?: boolean
  /** 需要的权限组ID（已废弃，使用 resourceId + resourceType 代替） */
  groupIds?: number[]
  /** 资源ID（HashID） */
  resourceId?: string | number
  /** 资源类型 */
  resourceType?: ResourceType
  /** 通过检查后的回调 */
  onClick?: () => void
  /** 检查失败的回调 */
  onFailed?: () => void
}

/**
 * 检查登录状态
 */
export function checkLoginStatus(): boolean {
  const userStore = useUserStore.getState()
  return userStore.is_login
}

/**
 * 检查版本权限（旧逻辑，外部用户前端分组判断）
 */
export const checkVersionPermission = (groupIds?: number[]): boolean => {
  if (!groupIds || groupIds.length === 0) return true

  const userStore = useUserStore.getState()
  const userGroupIds = userStore.info.group_ids || []
  const hasPermission = Boolean(
    userGroupIds.length && groupIds.some((id) => userGroupIds.includes(id))
  )

  if (!hasPermission) {
    message.warning(tApp('app.no_agent_permission'))
    return false
  }

  return true
}

/**
 * 异步检查资源权限（SSO 内部用户使用新接口）
 * @param resourceId 资源ID（HashID）
 * @param resourceType 资源类型：agent | space | library | prompt ...
 * @returns 用户是否有权限访问该资源
 */
export const checkScopePermissionAsync = async (
  resourceId: string | number,
  resourceType: ResourceType
): Promise<boolean> => {
  try {
    const res: any = await request.get('/api/resource-scopes/check', {
      params: {
        resource_id: resourceId,
        resource_type: resourceType,
      },
    })
    const hasPermission = res?.data === true
    if (!hasPermission) {
      message.warning(tApp('app.no_agent_permission'))
    }
    return hasPermission
  } catch (error) {
    console.error('检查资源权限失败:', error)
    return false
  }
}

/**
 * 统一的认证检查函数（异步版本）
 * @param options 认证选项
 * @returns 是否通过认证
 */
export const checkPermissionAsync = async (options: AuthOptions = {}): Promise<boolean> => {
  const { groupIds, onClick, onFailed, resourceId, resourceType } = options

  // 检查登录状态
  if (!checkLoginStatus()) {
    onFailed?.()
    return false
  }

  // 有 resourceId + resourceType：使用新接口检查资源权限
  if (resourceId && resourceType) {
    const hasPermission = await checkScopePermissionAsync(resourceId, resourceType)
    if (!hasPermission) {
      onFailed?.()
      return false
    }
  } else if (groupIds && groupIds.length > 0) {
    // 旧逻辑：通过 groupIds 检查
    if (!checkVersionPermission(groupIds)) {
      onFailed?.()
      return false
    }
  }

  // 如果所有检查都通过，执行回调
  onClick?.()

  return true
}

/**
 * 统一的认证检查函数（同步版本）
 * @param options 认证选项
 * @returns 是否通过认证
 * @deprecated 推荐使用 checkPermissionAsync
 */
export function checkPermission(options: AuthOptions = {}): boolean {
  const { groupIds, onClick, onFailed } = options

  // 检查登录状态
  if (!checkLoginStatus()) {
    message.warning(tApp('app.please_login_first'))
    onFailed?.()
    return false
  }

  // 检查版本权限
  if (!checkVersionPermission(groupIds)) {
    onFailed?.()
    return false
  }

  // 如果所有检查都通过，执行回调
  onClick?.()

  return true
}
