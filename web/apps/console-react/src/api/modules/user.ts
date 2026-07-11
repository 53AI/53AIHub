import service from '../config'
import { handleError } from '../error-handler'
import { getSimpleDateFormatString } from '@km/shared-utils'
import type { EnterpriseSyncFrom } from '@/constants/enterprise'

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

export function getFormatUserData(data: any = {}) {
  data.expired_time = +data.expired_time || 0
  data.created_time = +data.created_time || 0
  data.add_admin_time = +data.add_admin_time || 0
  if (data.expired_time) data.expired_time = getSimpleDateFormatString({ date: data.expired_time })
  if (data.created_time) data.register_time = getSimpleDateFormatString({ date: data.created_time })
  if (data.add_admin_time)
    data.add_admin_time = getSimpleDateFormatString({ date: data.add_admin_time })

  data.role = data.role || USER_ROLE_NORMAL
  data.role_label = USER_ROLE_LABEL_MAP.get(data.role)
  data.is_admin = data.role === USER_ROLE_ADMIN
  data.is_creator = data.role === USER_ROLE_CREATOR

  data.departments = data.departments || []
  data.dept_id_list = data.departments.map((item: any) => +item.did).filter((did: number) => did)
  data.dept_names = data.departments.map((item: any) => item.name).join(',')

  return data
}

export const userApi = {
  batch_save_admin(data: { user_ids: number[] }) {
    return service.put('/api/users/batch/admin', data).catch(handleError)
  },
  batch_remove_admin(data: { user_ids: number[] }) {
    return service.delete('/api/users/batch/admin', { data }).catch(handleError)
  },
  async fetch_admin_user(params: { keyword?: string; offset?: number; limit?: number }) {
    const {
      data: { count = 0, users = [] },
    } = await service.get('/api/users/admin', { params }).catch(handleError)
    return {
      total: count,
      list: users.map((item: any) => getFormatUserData(item)),
    }
  },
  async fetch_internal_user(params: {
    keyword?: string
    from?: EnterpriseSyncFrom
    status?: InternalUserStatus
    not_bind?: 0 | 1
    did?: number
    offset?: number
    limit?: number
  }) {
    if (typeof params.status === 'undefined') params.status = INTERNAL_USER_STATUS_ALL
    const {
      data: { count = 0, users = [] },
    } = await service.get('/api/users/internal', { params }).catch(handleError)
    return {
      total: count,
      list: users.map((item: any) => getFormatUserData(item)),
    }
  },
  batch_save_internal_user(data: {
    users: {
      did: number[]
      nickname: string
      password: string
      username: string
    }[]
  }) {
    if (data.users && data.users.length) {
      data.users = data.users.map(item => {
        if (!Array.isArray(item.did)) item.dids = [item.did || 0]
        return item
      })
    }
    return service.post('/api/users/internal/batch', data).catch(handleError)
  },
  update_internal_user(data: {
    user_id?: number
    department?: number[]
    email?: string
    mobile?: string
    nickname?: string
    status?: InternalUserStatus
  }) {
    const user_id = data.user_id
    delete data.user_id
    return service.put(`/api/users/internal/${user_id}`, data).catch(handleError)
  },
  delete_user(data: { user_id: number }) {
    return service.delete(`/api/users/${data.user_id}`).catch(handleError)
  },
  register_to_internal(data: {
    user_departments: {
      did: number[]
      user_id: number
    }[]
  }) {
    if (data.user_departments && data.user_departments.length) {
      data.user_departments = data.user_departments.map(item => {
        if (!Array.isArray(item.did)) item.dids = [item.did || 0]
        return item
      })
    }
    return service.put('/api/users/register/to/internal', data).catch(handleError)
  },
  update_user_status(data: { user_id: number; status: InternalUserStatus }) {
    const { user_id, status } = data
    return service.patch(`/api/users/${user_id}/status`, { status }).catch(handleError)
  },
  organization(params: {
    did: number
    status: number
    from: EnterpriseSyncFrom
    keyword: string
    offset: number
    limit: number
  }) {
    return service.get('/api/users/organization', { params }).catch(handleError)
  },
}

export default userApi
