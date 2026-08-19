import { create } from 'zustand'
import { Modal, message } from 'antd'
import userApi from '@/api/modules/user/index'
import { RawUserInfo } from '@/api/modules/user/types'
import { subscriptionApi } from '@/api/modules/subscription'
import { eventBus } from '@km/shared-utils'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { EVENT_NAMES } from '@/constants/events'
import { isOpLocalEnv, isPrivatePrem } from '@/utils/config'
import { t } from '@/locales'

export const DEFAULT_GROUP_NAME = '免费版'
export const DEFAULT_GROUP_ICON = 'vip-1'

const TOKEN_KEY = 'access_token'
const ONE_DAY_MS = 1000 * 60 * 60 * 24

export interface UserState {
  info: RawUserInfo
  is_login: boolean
  subscriptions: Subscription.State[]
  // Actions
  login: (data: User.LoginForm) => Promise<void>
  sms_login: (data: User.SmsLoginForm) => Promise<void>
  wechat_login: (params: { unionid?: string }) => Promise<any>
  sso_login: (query: any) => Promise<void>
  bind_wechat: (data: User.BindWechatForm) => Promise<void>
  unbind_wechat: () => Promise<void>
  register: (data: User.RegisterForm) => Promise<void>
  reset_password: (data: User.ResetPasswordForm) => Promise<void>
  change_mobile: (data: User.ChangeMobileForm, id: string) => Promise<void>
  update: (data: Partial<RawUserInfo>) => Promise<void>
  getUserInfo: (force?: boolean) => Promise<void>
  setGroupName: (group_name: string) => void
  setGroupIcon: (group_icon: string) => void
  setAccessToken: (token: string) => void
  updateInfo: (data: Partial<RawUserInfo>) => void
  logout: (options?: { redirectDisabled?: boolean }) => Promise<void>
}

const useDefaultUser = (): RawUserInfo => ({
  access_token: localStorage.getItem(TOKEN_KEY) || '',
  user_id: '',
  eid: '',
  openid: '',
  username: '',
  nickname: '',
  avatar: '',
  email: '',
  role: 0,
  mobile: '',
  group_id: 0,
  group_ids: [],
  group_name: DEFAULT_GROUP_NAME,
  group_icon: DEFAULT_GROUP_ICON,
  group_expire_day: 99,
  group_isexpired: false,
  group_expire_time: '',
  is_internal: false,
})

const defaultUser = useDefaultUser()

export const useUserStore = create<UserState>((set, get) => ({
  info: { ...defaultUser },
  is_login: false,
  subscriptions: [],

  login: async (data: User.LoginForm) => {
    try {
      const res = await userApi.login(data)
      get().setAccessToken(res.data.access_token)
      await get().getUserInfo()
      eventBus.emit(EVENT_NAMES.LOGIN_SUCCESS)
      message.success(t("status.login_success"));
    } catch (error) {
      throw error
    }
  },

  sms_login: async (data: User.SmsLoginForm) => {
    try {
      const res = await userApi.sms_login(data)
      get().setAccessToken(res.data.access_token)
      await get().getUserInfo()
      eventBus.emit(EVENT_NAMES.LOGIN_SUCCESS)
      message.success(t("status.login_success"));
    } catch (error) {
      throw error
    }
  },

  wechat_login: async (params: { unionid?: string }) => {
    try {
      const res = await userApi.wechat_login(params).catch(() => ({ data: { access_token: '' } }))
      if (!res.data.user.access_token) return Promise.reject(new Error('access_token is empty'))
      get().setAccessToken(res.data.user.access_token)
      await get().getUserInfo()
      eventBus.emit(EVENT_NAMES.LOGIN_SUCCESS)
      message.success(t("status.login_success"));
      return res.data
    } catch (error) {
      throw error
    }
  },

  sso_login: async (query: any = {}) => {
      const res = await userApi.ssoLogin({
        sign: query.sign || '',
        timestamp: query.timestamp || '',
        username: query.username || ''
      })
      if (res.code === 0) {
        const token = res.data.access_token
        get().setAccessToken(token)
        await get().getUserInfo(true, token)
        eventBus.emit(EVENT_NAMES.LOGIN_SUCCESS)
      }
  },

  bind_wechat: async (data: User.BindWechatForm) => {
    const res = await userApi.bind_wechat(data)
    const isCreated = Boolean(res.data.access_token && data.mobile)
    if (isCreated) get().setAccessToken(res.data.access_token)
    await get().getUserInfo()
    if (isCreated) eventBus.emit(EVENT_NAMES.LOGIN_SUCCESS)
  },

  unbind_wechat: async () => {
    await userApi.unbind_wechat()
    await get().getUserInfo()
  },

  register: async (data: User.RegisterForm) => {
    const registerData = {
      ...data,
      nickname: data.nickname || data.username
    }
    const res = await userApi.register(registerData)
    get().setAccessToken(res.data.access_token)
  },

  reset_password: async (data: User.ResetPasswordForm) => {
    await userApi.reset_password(data)
    await get().getUserInfo()
  },

  change_mobile: async (data: User.ChangeMobileForm, id: string) => {
    await userApi.change_mobile(data, id)
    await get().getUserInfo()
  },

  update: async (data: Partial<RawUserInfo>) => {
    await userApi.update(data)
    set((state) => ({
      info: {
        ...state.info,
        nickname: data.nickname,
        avatar: data.avatar,
      }
    }))
  },

  getUserInfo: async (force = true, access_token = '') => {
    const state = get()
    if ((!localStorage.getItem(TOKEN_KEY) || state.is_login) && !force) return

    try {
      const [res, { list: subscription_list = [] }] = await Promise.all([
        userApi.me(),
        subscriptionApi.list()
      ])
      const info: RawUserInfo = {
        access_token: res.access_token || access_token || '',
        user_id: res.user_id || '',
        openid: res.openid || '',
        username: res.username || '',
        nickname: res.nickname || '',
        avatar: res.avatar || '',
        email: res.email || '',
        eid: res.eid || 0,
        role: res.role || 0,
        mobile: res.mobile || '',
        group_id: res.group_id || 0,
        group_ids: res.group_ids || [],
        group_name: res.group_name || DEFAULT_GROUP_NAME,
        group_icon: res.group_icon || DEFAULT_GROUP_ICON,
        group_expire_time: res.expired_time
          ? getSimpleDateFormatString({
              date: res.expired_time,
              format: 'YYYY-MM-DD hh:mm'
            })
          : '',
        group_expire_day: res.expired_time
          ? Math.max(
              Math.ceil((new Date(res.expired_time).getTime() - Date.now()) / ONE_DAY_MS),
              0
            )
          : 99,
        group_isexpired: res.expired_time ? res.expired_time < Date.now() : false,
        is_internal: res.type === 2
      }

      const subscription_data = subscription_list.find(
        (item = {}) => item.group_id === info.group_id
      )

      if (info.is_internal || !subscription_data) {
        info.group_expire_time = ''
        info.group_isexpired = false
        info.group_expire_day = 99
      } else {
        info.group_name = subscription_data.group_name || DEFAULT_GROUP_NAME
        info.group_icon = subscription_data.logo_url || DEFAULT_GROUP_ICON
        if (subscription_data.is_default) {
          info.group_expire_time = ''
          info.group_isexpired = false
          info.group_expire_day = 99
        }
      }

      set({
        info,
        is_login: true,
        subscriptions: subscription_list
      })

      if (window.$chat53ai) {
        window.$chat53ai.$win({ type: 'agenthub_login', data: JSON.stringify({ ...info }) })
      }
    } catch (error: any) {
      const response = error.response || {}
      const data = response.data || error || {}
      const { message, code } = data

      // 处理账户被禁用的情况
      if (code === 9 || message?.includes('账户已被禁用')) {
        Modal.info({
          title: t('common.tip'),
          content: t('status.account_disabled_desc'),
          okText: t('action.confirm'),
          okType: 'primary',
          onOk: () => {
            localStorage.removeItem(TOKEN_KEY)
            eventBus.clearCache(EVENT_NAMES.LOGIN_SUCCESS)
          },
        })
        throw error
      }

      if (['token expired', 'forbidden'].includes(message)) {
        get().logout({ redirectDisabled: true })
      }
      throw error
    }
  },

  setGroupName: (group_name: string) => {
    set((state) => ({
      info: { ...state.info, group_name: group_name || DEFAULT_GROUP_NAME }
    }))
  },

  setGroupIcon: (group_icon: string) => {
    set((state) => ({
      info: { ...state.info, group_icon: group_icon || DEFAULT_GROUP_ICON }
    }))
  },

  setAccessToken: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem('user_info', JSON.stringify({ access_token: token }))
    set((state) => ({
      info: { ...state.info, access_token: token }
    }))
  },

  updateInfo: (data) => {
    set((state) => ({
      info: { ...state.info, ...data },
      is_login: true
    }))
  },

  logout: async ({ redirectDisabled = false } = {}) => {
    set({
      info: { ...defaultUser },
      is_login: false
    })
    if (!isOpLocalEnv && !isPrivatePrem) {
      await userApi.logout()
    }
    localStorage.removeItem(TOKEN_KEY)
    eventBus.clearCache(EVENT_NAMES.LOGIN_SUCCESS)

    setTimeout(() => {
      if (!redirectDisabled) {
        window.location.href = '/'
      }
    }, 800)
  }
}))
