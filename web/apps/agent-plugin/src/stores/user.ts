import { create } from 'zustand'
import request from '../utils/request'
import { clearFingerprint } from '../utils/fingerprint'
import { tApp } from '../i18n'

export const TOKEN_KEY = 'agentplugin_access_token'
export const CURRENT_AGENT_ID_KEY = 'agentplugin_current_agent_id'

// Token storage: { [agent_id]: access_token }
type TokenStore = Record<string, string>

export interface UserInfo {
  access_token: string
  user_id: string
  username: string
  nickname: string
  avatar: string
  email: string
  mobile: string
  /** 用户所属分组 IDs（外部用户为订阅分组，内部用户为内部用户组） */
  group_ids: number[]
  /** 是否内部用户（/api/users/me 的 type === 2） */
  is_internal: boolean
}

interface H5LoginResponse {
  access_token: string
  user_id: string
  username: string
  nickname: string
  agent_id: string
  channel_id: string
  channel_type: string
  expires_at: string
}

interface UserState {
  info: UserInfo
  is_login: boolean
  getAccessToken: (agentId: string | number) => string | null
  setAccessToken: (agentId: string | number, token: string) => void
  removeAccessToken: (agentId: string | number) => void
  setUserInfo: (info: Partial<UserInfo>) => void
  h5Login: (fixedToken: string, fingerprintCode: string) => Promise<H5LoginResponse>
  ssoLogin: (params: { sign: string; timestamp: string; username: string; agentId: string | number }) => Promise<void>
  logout: () => Promise<void>
  getUserInfo: (agentId: string | number) => Promise<void>
}

const defaultUser: UserInfo = {
  access_token: '',
  user_id: '',
  username: '',
  nickname: '',
  avatar: '',
  email: '',
  mobile: '',
  group_ids: [],
  is_internal: false,
}

function loadTokenStore(): TokenStore {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveTokenStore(store: TokenStore) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(store))
}

/** Get access token for current agent (from localStorage) */
export function getCurrentAccessToken(): string | null {
  try {
    const currentAgentId = localStorage.getItem(CURRENT_AGENT_ID_KEY)
    if (!currentAgentId) return null

    const store = loadTokenStore()
    return store[currentAgentId] || null
  } catch {
    return null
  }
}

export const useUserStore = create<UserState>((set, get) => ({
  info: { ...defaultUser },
  is_login: false,

  getAccessToken: (agentId: string | number): string | null => {
    const store = loadTokenStore()
    return store[agentId] || null
  },

  setAccessToken: (agentId: string | number, token: string) => {
    const store = loadTokenStore()
    store[agentId] = token
    saveTokenStore(store)
    localStorage.setItem(CURRENT_AGENT_ID_KEY, String(agentId))
    set((state) => ({
      info: { ...state.info, access_token: token }
    }))
  },

  removeAccessToken: (agentId: string | number) => {
    const store = loadTokenStore()
    delete store[agentId]
    saveTokenStore(store)
  },

  setUserInfo: (info: Partial<UserInfo>) => {
    set((state) => ({
      info: { ...state.info, ...info },
      is_login: true
    }))
  },

  h5Login: async (fixedToken: string, fingerprintCode: string): Promise<H5LoginResponse> => {
    const res: any = await request.post('/api/agents/h5/login', {
      fixed_token: fixedToken,
      fingerprint_code: fingerprintCode
    })
    if (res?.code === 0 && res?.data?.access_token) {
      const data = res.data as H5LoginResponse
      const agentId = data.agent_id
      get().setAccessToken(agentId, data.access_token)
      set({
        info: {
          ...get().info,
          access_token: data.access_token,
          user_id: data.user_id,
          username: data.username,
          nickname: data.nickname,
        },
        is_login: true
      })
      return data
    } else {
      throw new Error(res?.message || tApp('app.login_failed'))
    }
  },

  ssoLogin: async (params: { sign: string; timestamp: string; username: string; agentId: string | number }) => {
    const res: any = await request.post('/api/auth/sso_login', params)
    if (res?.code === 0 && res?.data?.access_token) {
      const agentId = params.agentId
      get().setAccessToken(agentId, res.data.access_token)
      set((state) => ({
        info: { ...state.info, access_token: res.data.access_token },
        is_login: true
      }))
    } else {
      throw new Error(res?.message || tApp('app.sso_login_failed'))
    }
  },

  logout: async () => {
    try {
      await request.delete('/api/agents/h5/token')
    } catch {
      // Ignore logout API errors
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(CURRENT_AGENT_ID_KEY)
    localStorage.removeItem('user_info')
    clearFingerprint()
    set({
      info: { ...defaultUser },
      is_login: false
    })
  },

  getUserInfo: async (agentId: string | number) => {
    const token = get().getAccessToken(agentId)
    if (!token) return

    try {
      const res: any = await request.get('/api/users/me')
      const info = res?.data || res
      set((state) => ({
        info: {
          ...state.info,
          user_id: info.user_id || '',
          username: info.username || '',
          nickname: info.nickname || '',
          avatar: info.avatar || '',
          email: info.email || '',
          mobile: info.mobile || '',
          group_ids: Array.isArray(info.group_ids) ? info.group_ids : [],
          is_internal: info.type === 2,
        },
        is_login: true
      }))
    } catch (error) {
      console.error('获取用户信息失败:', error)
      throw error
    }
  },
}))
