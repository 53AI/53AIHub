import { defineStore } from 'pinia'
import { deepCopy } from '@/utils'
import api from '@/apis'
import eventBus from '@/utils/event-bus'
import { getFormatUserData, USER_ROLE_NORMAL, USER_ROLE_ADMIN, USER_ROLE_CREATOR, USER_ROLE_LABEL_MAP } from '@/api/modules/user'
export interface User {
  access_token: string
  user_id: string
  eid: string
}

export const useDefaultUser = () => ({
  access_token: localStorage.getItem('access_token') || '',
  user_id: '',
  eid: '',
  ...JSON.parse(localStorage.getItem('user_info') || '{}'),
})
const default_user = useDefaultUser()

export const useUserStore = defineStore('user-store', {
  state: () => ({
		info: deepCopy(default_user),
		is_new_user: false,
    is_saas_login: false,
  }),
  actions: {
    async login({ type = 'password', data: { username, password, verify_code }, hideError = false }: { type: 'password' | 'mobile'; data: { username: string; password: string; verify_code: string }; hideError: boolean }) {
      const { data = {} } = await api.user[type === 'mobile' ? 'saas_sms_login' : 'saas_login']({ data: type === 'mobile' ? { mobile: username, verify_code } : { username, password, verify_code }, hideError })
      this.info = {
        ...this.info,
        ...data,
			}
			this.is_new_user = !!+data.is_new_user
      localStorage.setItem('access_token', this.info.access_token)
      localStorage.setItem('user_info', JSON.stringify(this.info))
      eventBus.emit('user-login-success', this)
      // this.loadSelfInfo()
      return this
    },
    async logoff({ show_confirm = false, back_to_login = false } = {}) {
      if (show_confirm)
        await ElMessageBox.confirm(window.$t('action_exit_confirm'), window.$t('action_exit'))
      localStorage.removeItem('access_token')
      localStorage.removeItem('user_info')
      this.is_saas_login = false
      this.info = useDefaultUser()
      if (back_to_login)
        eventBus.emit('user-login-expired', this)
    },
    async resetPassword({ data: { mobile, new_password, confirm_password, verify_code } }: { data: { mobile: string; new_password: string; confirm_password: string; verify_code: string } }) {
      return api.user.reset_password({ data: { mobile, new_password, confirm_password, verify_code } })
    },
    setAccessToken(access_token: string) {
      this.info.access_token = access_token
      localStorage.setItem('access_token', this.info.access_token)
      localStorage.setItem('user_info', JSON.stringify(this.info))
    },
    setEid(eid: string) {
      this.info.eid = eid
      localStorage.setItem('user_info', JSON.stringify(this.info))
    },
    setIsSaasLogin(is_saas_login: boolean) {
      this.is_saas_login = is_saas_login
		},
		setIsNewUser(is_new_user: boolean) {
			this.is_new_user = is_new_user
		},
    async loadListData({ data: { role = '', keyword = '', group_id, offset = 0, limit = 10 }, hideError = false }: { data: { role?: string; keyword?: string; group_id?: number; offset?: number; limit?: number }; hideError: boolean }) {
      let { data: { count = 0, users = [] } = {} } = await api.user.list({ data: { role, keyword, group_id, offset, limit }, hideError })
      return {
				total: count,
				list: users.map(item => getFormatUserData(item))
			}
    },
    async delete({ data: { user_id } }: { data: { user_id: string } }) {
      return api.user.delete({ data: { user_id } })
    },
    async save({ data = {} }: { data: { user_id: string } }) {
      data = {
        user_id: 0,
        avatar: '',
        expired_time: 0,
        group_id: 0,
        nickname: '',
        password: '',
        ...data,
      }
      if (!data.user_id)
        delete data.user_id
      if (!data.password)
        delete data.password
      return api.user.update({ data })
		},

		async loadSelfInfo() {
			const access_token = localStorage.getItem('access_token')
			if (!access_token) return Promise.reject('no access_token')
			const { data = {} } =  await api.user.self_info()
			this.info = {
				...this.info,
				...data,
			}
			localStorage.setItem('user_info', JSON.stringify(this.info))
      eventBus.emit('load-user-self-info-success', this)
			return this
		},
    // async register({ data: { username, password, nickname } }: { data: { username: string, password: string, nickname: string } }) {
    // 	const { data = {} } = await api.user.register({ data: { username, password, nickname: nickname || username } })
    // 	this.info.access_token = data.access_token || ''
    // 	this.info.user_id = data.user_id || ''
    // 	localStorage.setItem('access_token', this.info.access_token)
    // 	eventBus.emit('user-login-success', this)
    // 	this.loadSelfInfo()
    // 	return this
    // },
    // async loadSelfInfo() {
    // 	if (!this.is_saas_login) return Promise.reject('no login')
    // 	const { data = {} } = await api.user.self_info()
    // 	this.info = {
    // 		...this.info,
    // 		...data,
    // 	}
    // 	return this
    // },
  },
})
