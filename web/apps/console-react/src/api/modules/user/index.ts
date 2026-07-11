import service from '../../config'
import { handleError } from '../../error-handler'

/**
 * 与 Vue Console 端 `apps/console/src/apis/modules/user.ts` 对齐的 user 模块
 * 保持返回结构中包含 `data` 字段，方便在 Store 中解构使用。
 */

export const USER_ROLE_NORMAL = 1
export const USER_ROLE_ADMIN = 10
export const USER_ROLE_CREATOR = 10000
export const USER_ROLE_LABEL_MAP = new Map([
  [USER_ROLE_NORMAL, 'role.normal'],
  [USER_ROLE_ADMIN, 'role.admin'],
  [USER_ROLE_CREATOR, 'role.creator'],
])

export const INTERNAL_USER_STATUS_ALL = -1
export const INTERNAL_USER_STATUS_UNDEFINED = 0
export const INTERNAL_USER_STATUS_ENABLED = 1
export const INTERNAL_USER_STATUS_DISABLED = 2
export type InternalUserStatus =
  | typeof INTERNAL_USER_STATUS_ALL
  | typeof INTERNAL_USER_STATUS_UNDEFINED
  | typeof INTERNAL_USER_STATUS_ENABLED
  | typeof INTERNAL_USER_STATUS_DISABLED
export const INTERNAL_USER_STATUS_LABEL_MAP = new Map<InternalUserStatus, string>([
  [INTERNAL_USER_STATUS_ALL, 'internal_user.status.all'],
  [INTERNAL_USER_STATUS_UNDEFINED, 'internal_user.status.undefined'],
  [INTERNAL_USER_STATUS_ENABLED, 'internal_user.status.enabled'],
  [INTERNAL_USER_STATUS_DISABLED, 'internal_user.status.disabled'],
])

export interface SaasLoginParams {
  username?: string
  password?: string
  verify_code?: string
}

export interface SaasSmsLoginParams {
  mobile: string
  verify_code: string
}

export interface ResetPasswordParams {
  mobile: string
  email: string
  new_password: string
  confirm_password: string
  verify_code: string
}

export interface UserListParams {
  role?: string
  keyword?: string
  group_id?: number
  offset?: number
  limit?: number
  start_time?: string
  end_time?: string
  range_by?: string
}

export interface UserUpdateParams {
  user_id?: number | string
  avatar?: string
  expired_time?: number
  group_id?: number
  nickname?: string
  password?: string
  // 允许扩展其它字段
  [key: string]: unknown
}

export const userApi = {
  saas_login(data: SaasLoginParams & { verify_code?: string }) {
    return service.post('/api/saas/auth/login', data)
  },

  saas_sms_login(data: SaasSmsLoginParams) {
    return service.post('/api/saas/auth/sms_login', data)
  },

  saas_logout() {
    return service.post('/api/saas/auth/logout').catch(handleError)
  },

  logout() {
    return service.post('/api/logout').catch(handleError)
  },

  register(data: { username: string; password: string; nickname?: string }) {
    return service.post('/api/register', data).catch(handleError)
  },

  self_info<T = unknown>() {
    return service.get<T>('/api/users/me').catch(handleError)
  },

  reset_password(data: ResetPasswordParams) {
    return service.post('/api/saas/auth/reset_password', data).catch(handleError)
  },

  list<T = unknown>(params: UserListParams) {
    return service.get<T>('/api/users', { params }).catch(handleError)
  },

  delete(config: { user_id: string | number }) {
    const { user_id } = config
    return service.delete(`/api/users/${user_id}`).catch(handleError)
  },

  update(data: UserUpdateParams & { user_id?: string | number }) {
    const { user_id, ...payload } = data
    const id = user_id ?? ''
    return service.put(`/api/users/${id}`, payload).catch(handleError)
  },

  async fetch_internal_user(params: any) {
    const res = await service.get('/api/users/internal', { params }).catch(handleError)
    const { count = 0, users = [] } = res?.data || res || {}
    return { total: count, list: users }
  },

  batch_save_internal_user(data: any) {
    if (data.users && data.users.length) {
      data.users = data.users.map((item: any) => {
        if (!Array.isArray(item.did)) item.dids = [item.did || 0]
        return item
      })
    }
    return service.post('/api/users/internal/batch', data).catch(handleError)
  },

  update_internal_user(data: any) {
    return service.put('/api/users/internal', data).catch(handleError)
  },

  delete_user(data: { user_id: number | string }) {
    return service.delete(`/api/users/${data.user_id}`).catch(handleError)
  },

  register_to_internal(data: any) {
    return service.post('/api/users/internal/register', data).catch(handleError)
  },

  update_user_status(data: { user_id: number | string; status: number }) {
    return service.put(`/api/users/${data.user_id}/status`, { status: data.status }).catch(handleError)
  },

  organization(params: any) {
    return service.get('/api/users/organization', { params }).catch(handleError)
  },
}

export default userApi
