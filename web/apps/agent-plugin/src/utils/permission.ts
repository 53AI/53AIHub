/**
 * Permission utility functions for agent-plugin
 */
import { message } from 'antd'
import { useUserStore } from '../stores/user'

export interface PermissionOptions {
  /** 需要的权限组ID */
  groupIds?: number[]
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
 * 检查版本权限
 */
export function checkVersionPermission(groupIds?: number[]): boolean {
  if (!groupIds || groupIds.length === 0) return true

  // agent-plugin 用户信息可能没有 group_ids，暂时返回 true
  // 实际项目中需要根据业务逻辑判断
  return true
}

/**
 * 统一的认证检查函数
 */
export function checkPermission(options: PermissionOptions = {}): boolean {
  const { groupIds, onClick, onFailed } = options

  // 检查登录状态
  if (!checkLoginStatus()) {
    message.warning('请先登录')
    onFailed?.()
    return false
  }

  // 检查版本权限
  if (!checkVersionPermission(groupIds)) {
    message.warning('您没有使用该智能体的权限')
    onFailed?.()
    return false
  }

  // 如果所有检查都通过，执行回调
  onClick?.()

  return true
}
