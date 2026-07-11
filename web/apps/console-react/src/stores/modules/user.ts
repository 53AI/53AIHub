import { create } from 'zustand'
import { Modal } from 'antd'
import { gotoLogin } from '@/router/guards'
import { deepCopy, eventBus } from '@km/shared-utils'
import { saasApi } from '@/api'
import { userApi as consoleUserApi } from '@/api/modules/user/index'
import { getFormatUserData } from '@/api/modules/user'
import { systemLogApi } from '@/api/modules/system-log'
import { SYSTEM_LOG_ACTION } from '@/constants/system-log'
import { isPrivatePrem } from '@/hooks/useEnv'

export interface UserInfoState {
  access_token: string
  user_id: string
  eid: string
  [key: string]: unknown
}

export interface BindWechatForm {
  mobile?: string
  verify_code?: string
  openid: string
  unionid?: string
  nickname?: string
  from?: string
}

function getDefaultUser(): UserInfoState {
  return {
    access_token: localStorage.getItem('access_token') || '',
    user_id: '',
    eid: '',
    ...JSON.parse(localStorage.getItem('user_info') || '{}'),
  }
}

interface UserState {
  info: UserInfoState
  is_new_user: boolean
  is_saas_login: boolean
  unRegistered_username: string
  login: (opts: {
    type: 'password' | 'mobile'
    data: { username: string; password: string; verify_code: string }
    hideError?: boolean
  }) => Promise<UserState>
  wechat_login: (params: { unionid: string; from?: string }) => Promise<unknown>
  bind_wechat: (data: BindWechatForm) => Promise<unknown>
  setAccessToken: (access_token: string) => void
  setEid: (eid: string) => void
  setIsSaasLogin: (v: boolean) => void
  setIsNewUser: (v: boolean) => void
  logoff: (options?: { show_confirm?: boolean; back_to_login?: boolean }) => Promise<void>
  resetPassword: (opts: {
    data: {
      mobile: string
      email: string
      new_password: string
      confirm_password: string
      verify_code: string
    }
  }) => Promise<unknown>
  loadListData: (opts: {
    data?: {
      role?: string
      keyword?: string
      group_id?: number
      offset?: number
      limit?: number
      start_time?: string
      end_time?: string
      range_by?: string
    }
    hideError?: boolean
  }) => Promise<{ total: number; list: unknown[] }>
  delete: (opts: { data: { user_id: string } }) => Promise<unknown>
  save: (opts: { data?: Record<string, unknown> & { user_id?: number } }) => Promise<unknown>
  loadSelfInfo: () => Promise<unknown>
}

export const useUserStore = create<UserState>((set, get) => ({
  info: deepCopy(getDefaultUser()),
  is_new_user: false,
  is_saas_login: false,
  unRegistered_username: '',

  async login({ type = 'password', data: { username, password, verify_code }, hideError = false }) {
    const apiMethod = type === 'mobile' ? 'saas_sms_login' : 'saas_login'
    const payload =
      type === 'mobile'
        ? { mobile: username, verify_code }
        : { username, password, verify_code }

    const res: any = await (consoleUserApi as any)[apiMethod]({
      ...payload,
      hideError,
    })
    const { data = {} } = res || {}

    set(state => ({
      info: {
        ...state.info,
        ...data,
      },
      is_new_user: !!+data.is_new_user,
    }))

    const current = get().info
    localStorage.setItem('access_token', current.access_token || '')
    localStorage.setItem('site_token', current.access_token || '')
    localStorage.setItem('user_info', JSON.stringify(current))
    eventBus.emit('user-login-success', get())

    return get()
  },

  async wechat_login(params: { unionid: string; from?: string }) {
    const res: any =
      (await saasApi.wechat_login(params).catch(() => ({ data: { platform_user: { access_token: '' } } }))) || {}
    const accessToken = res?.data?.platform_user?.access_token
    if (!accessToken) {
      return Promise.reject(new Error('access_token is empty'))
    }
    get().setAccessToken(accessToken)
    eventBus.emit('user-login-success', get())
    return res.data
  },

  async bind_wechat(data: BindWechatForm) {
    const res: any = await saasApi.bind_wechat(data)
    const isCreated = Boolean(res?.data?.access_token && data.mobile)
    if (isCreated) {
      get().setAccessToken(res.data.access_token)
      eventBus.emit('user-login-success', get())
    }
    return res
  },

  setAccessToken(access_token: string) {
    set(state => ({
      info: { ...state.info, access_token },
    }))
    localStorage.setItem('access_token', access_token)
    localStorage.setItem('user_info', JSON.stringify(get().info))
  },

  setEid(eid: string) {
    set(state => ({ info: { ...state.info, eid } }))
    localStorage.setItem('user_info', JSON.stringify(get().info))
  },

  setIsSaasLogin(is_saas_login: boolean) {
    set({ is_saas_login })
  },

  setIsNewUser(is_new_user: boolean) {
    set({ is_new_user })
  },

  async logoff(options?: { show_confirm?: boolean; back_to_login?: boolean }) {
    const doLogoff = async () => {
      if (options?.show_confirm) {
        await systemLogApi.create({
          action: SYSTEM_LOG_ACTION.LOGOUT,
          content: '退出',
        })
        await consoleUserApi.logout()
        if (!isPrivatePrem()) {
          await consoleUserApi.saas_logout()
        }
      }
      localStorage.removeItem('access_token')
      localStorage.removeItem('site_token')
      localStorage.removeItem('user_info')
      set({ is_saas_login: false, info: deepCopy(getDefaultUser()) })
      if (options?.back_to_login) {
        eventBus.emit('user-login-expired', get())
        gotoLogin()
      }
    }

    if (!options?.show_confirm) {
      await doLogoff()
      return
    }

    Modal.confirm({
      title: typeof window !== 'undefined' && (window as any).$t ? (window as any).$t('action_exit_confirm') : '确认退出登录？',
      okText: typeof window !== 'undefined' && (window as any).$t ? (window as any).$t('action_exit') : '退出',
      cancelText: '取消',
      onOk: doLogoff,
    })
  },

  async resetPassword({ data: { mobile, email, new_password, confirm_password, verify_code } }) {
    return consoleUserApi.reset_password({
      mobile,
      email,
      new_password,
      confirm_password,
      verify_code,
    })
  },

  async loadListData({
    data: {
      role = '',
      keyword = '',
      group_id,
      offset = 0,
      limit = 10,
      start_time,
      end_time,
      range_by,
    } = {},
    hideError = false,
  } = {}) {
    const res: any = await consoleUserApi.list({
      role,
      keyword,
      group_id,
      offset,
      limit,
      start_time,
      end_time,
      range_by,
    })
    const { count = 0, users = [] } = res?.data || {}
    return {
      total: count,
      list: users.map((item: any) => getFormatUserData(item)),
    }
  },

  async delete({ data: { user_id } }) {
    return consoleUserApi.delete({ user_id })
  },

  async save({ data = {} } = {}) {
    const d = {
      user_id: 0,
      avatar: '',
      expired_time: 0,
      group_id: 0,
      nickname: '',
      password: '',
      ...data,
    } as Record<string, unknown>
    if (!d.user_id) delete d.user_id
    if (!d.password) delete d.password
    return consoleUserApi.update(d as any)
  },

  async loadSelfInfo() {
    const access_token = localStorage.getItem('access_token')
    if (!access_token) return Promise.reject(new Error('no access_token'))

    const res: any = await consoleUserApi.self_info()
    const { data = {} } = res || {}

    set(state => ({
      info: {
        ...state.info,
        ...data,
      },
    }))

    localStorage.setItem('user_info', JSON.stringify(get().info))
    eventBus.emit('load-user-self-info-success', get())
    return get()
  },
}))
