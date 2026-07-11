import service from '../../config'
import { handleError } from '../../errorHandler'
import { isOpLocalEnv, isPrivatePrem } from '@/utils/config'

import { RawUserInfo } from './types'
import { getFormatUserData } from './transform'

const INTERNAL_USER_STATUS_ALL = -1

export const userApi = {
  login(data: { username: string; password: string }) {
    return service.post('/api/login', data).catch(handleError)
  },
  logout() {
    return service.post('/api/logout').catch(handleError)
  },
  sms_login(data: { mobile: string; verify_code: string }) {
    return service.post('/api/sms_login', data).catch(handleError)
  },
  wechat_login(params: { unionid: string }) {
    return service.get('/api/saas/wechat/user', { params })
  },
  bind_wechat(data: {
    mobile?: string
    verify_code?: string
    openid: string
    unionid?: string
    nickname?: string
  }) {
    let api_url = '/api/saas/wechat/bind'
    if (data.mobile) api_url = '/api/saas/wechat/user'
    return service.post(api_url, data).catch(handleError)
  },
  unbind_wechat() {
    return service.post('/api/saas/wechat/unbind').catch(handleError)
  },

  register(data: { username: string; password: string; nickname: string; verfiy_code?: string }) {
    return service.post('/api/register', data).catch(err => handleError(err, { functionName: window.$t('upgrade_dialog.register_user') }))
  },
  reset_password(data: User.ResetPasswordForm) {
    if (!isOpLocalEnv && !isPrivatePrem) {
      return service.post('/api/saas/auth/reset_password', data).then(res => res.data).catch(handleError)
    }
    return service.post('/api/reset_password', data).catch(handleError)
  },
  change_mobile(id: number, data: { new_code: string, new_mobile: string, old_code?: string }): Promise<RawUserInfo> {
    return service.patch(`/api/users/${id}/mobile`, data).then((res) => res.data).catch(err => handleError(err, { ignoreAuth: true }))
  },
  me(): Promise<RawUserInfo> {
    return service.get('/api/users/me').then((res) => res.data).catch(handleError)
  },
  update(data: { nickname?: string; avatar?: string }) {
    return service.put(`/api/users/me`, data).then((res) => res.data).catch(handleError)
  },
  updatePassword(data: { password: string; newPassword: string }) {
    return service.put(`/api/users/password`, data).catch(handleError)
  },
  checkUsername(account: string) {
    return service
      .post(`/api/check_account`, {
        account
      })
      .catch(handleError)
  },
  update_default_subscription(user_id: number) {
    return service.put(`/api/users/${user_id}/default_subscription`).catch(handleError)
  },
  ssoLogin(data: User.SsoLoginParam) {
    return service.post(`/api/auth/sso_login`, data).catch(handleError)
  },
  async fetch_internal_user(params: {
    keyword?: string
    from?: number
    status?: number
    not_bind?: 0 | 1
    did?: number
    offset?: number
    limit?: number
  }) {
    if (typeof params.status === 'undefined') params.status = INTERNAL_USER_STATUS_ALL
    const {
      data: { count = 0, users = [] }
    } = await service.get('/api/users/internal', { params }).catch(handleError)
    return {
      total: count,
      list: users.map((item) => getFormatUserData(item))
    }
  },
}

export default userApi
