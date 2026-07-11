import { create } from 'zustand'
import { deepCopy, eventBus, getSimpleDateFormatString } from '@km/shared-utils'
import { enterpriseApi } from '@/api/modules/enterprise'
import { saasApi } from '@/api/modules/saas'
import { licenseApi } from '@/api/modules/license'
import { isPrivatePrem } from '@/hooks/useEnv'
import { WEBSITE_VERSION, WEBSITE_VERSION_NAME_MAP, WEBSITE_TYPE } from '@/constants/enterprise'
import { useUserStore } from './user'
import { getPublicPath } from '@/utils/config'


export const WEBSITE_TYPE_INDEPENDENT = 'independent'
export const WEBSITE_TYPE_ENTERPRISE = 'enterprise'
export const WEBSITE_TYPE_INDUSTRY = 'industry'

export const getDefaultLogo = () => {
  return getPublicPath('/images/default_logo.png')
}

export type EnterpriseInfo = {
  id?: string
  eid: string
  is_independent?: boolean
  is_industry?: boolean
  is_enterprise?: boolean
  is_install_wecom?: boolean
  is_install_dingtalk?: boolean
  name?: string
  logo?: string
  domain?: string
  description?: string
  version?: number
  version_name?: string
  expired_time?: string
  created_time?: string
  is_process?: boolean
  is_reject?: boolean
  reject_reason?: string
  is_expired?: boolean
  is_loading?: boolean
  wecom_info?: Record<string, unknown>
  dingtalk_info?: Record<string, unknown>
  [key: string]: unknown
}

interface VersionFeatures {
  [featureKey: string]: { max?: number }
}

interface VersionState {
  product_id?: number
  name?: string
  version?: number
  features: VersionFeatures
  disabled_features?: string
  created_time?: number
  updated_time?: number
}

interface EnterpriseState {
  info: EnterpriseInfo
  version: VersionState
  getFormatEnterpriseData: (data?: Record<string, unknown>) => EnterpriseInfo
  loadListData: (opts: {
    data: { status: -1 | 0 | 1 | 2; offset: number; limit: number }
    hideError?: boolean
  }) => Promise<{ count: number; list: EnterpriseInfo[] }>
  apply: (opts: {
    data: {
      contact_name: string
      enterprise_name: string
      domain: string
      email: string
      phone: string
    }
    hideError?: boolean
  }) => Promise<unknown>
  loadDetailData: (opts: { data: { eid: string }; hideError?: boolean }) => Promise<EnterpriseInfo>
  loadSelfInfo: () => Promise<unknown>
  loadHomeInfo: () => Promise<Record<string, unknown>>
  update: (opts: {
    data: {
      eid: string
      logo: string
      ico?: string
      display_name: string
      language: string
      description: string
      keywords?: string
      copyright?: string
      type?: string
      layout_type?: 'portal' | 'doubao' | 'mita' | 'kimi' | 'independent'
      template_type?: string
      domain?: string
      slogan?: string
    }
  }) => Promise<unknown>
  loadVersionInfo: () => Promise<void>
  loadLicenseVersionInfo: () => Promise<void>
  loadSMTPInfo: () => Promise<Record<string, unknown>>
  loadSMTPDetail: (opts: { data: { type: string } }) => Promise<Record<string, unknown>>
  saveSMTPInfo: (opts: {
    data: {
      content: string
      enabled: boolean
      type: 'smtp' | 'mobile'
    }
  }) => Promise<unknown>
  sendTestEmail: (opts: {
    data: {
      from: string
      host: string
      is_ssl: boolean
      password: string
      port: number | string
      to: string
      username: string
    }
  }) => Promise<unknown>
}

const defaultVersion: VersionState = {
  product_id: 1,
  name: '创业版',
  version: 1,
  features: {
    agent: { max: 5 },
    independent_domain: { max: 0 },
    internal_user: { max: 0 },
    registered_user: { max: 100 },
  },
  disabled_features:
    '{"agent":{"max":5,"name":"智能体"},"independent_domain":{"max":0,"name":"独立域名"},"internal_user":{"max":0,"name":"内部用户"},"registered_user":{"max":100,"name":"注册用户"}}',
  created_time: 0,
  updated_time: 0,
}

function getInitialInfo(): EnterpriseInfo {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : ''
  const userInfo =
    typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('user_info') || '{}') : {}
  const eid = userInfo.eid || ''
  return {
    id: token ? 'dev' : '',
    eid,
    is_independent: false,
    is_industry: false,
    is_enterprise: false,
    is_install_wecom: false,
    is_install_dingtalk: false,
    domain: ''
  } as EnterpriseInfo
}

export const useEnterpriseStore = create<EnterpriseState>((set, get) => ({
  info: getInitialInfo(),
  version: deepCopy(defaultVersion),

  getFormatEnterpriseData(data: Record<string, unknown> = {}) {
    data.apply = data.apply || data.apply_info || {}
    data.domains = data.domains || []
    data.enterprise = data.enterprise || {}
    const d = data = {
      ...data,
      ...data.enterprise,
    }
    const apply = data.apply as any
    const enterprise = data.enterprise as any
    const domains = data.domains

    d.eid = d.eid || apply.eid || enterprise.id || ''
    d.logo = d.logo || enterprise.logo || getDefaultLogo()
    d.description = d.description || enterprise.description || ''
    d.domain = d.domain || domains[0]?.domain || ''
    if (d.domain) d.domain = `https://${String(d.domain).replace(/^https?:\/\//, '')}`
    d.apply_id = apply.apply_id || apply.id || ''
    d.apply_name = apply.enterprise_name || ''
    d.name = d.name || enterprise.display_name || (d as any).apply_name || ''
    d.is_process = apply.status == 0
    d.is_reject = apply.status == 2
    d.reject_reason = apply.reject_reason || apply.reason || ''
    d.expired_time = apply.expired_time || 0
    d.is_expired = (d as any).expired_time ? new Date((d as any).expired_time).getTime() < Date.now() : false
    d.expired_time = (d as any).expired_time
      ? getSimpleDateFormatString({
          date: new Date((d as any).expired_time),
          format: 'YYYY-MM-DD hh:mm',
        })
      : ''
    d.created_time = enterprise.created_time || 0
    d.created_time = getSimpleDateFormatString({ date: new Date(d.created_time as number) })
    d.version = Number(d.version || apply.version || 1)
    d.version_name =
      WEBSITE_VERSION_NAME_MAP[d.version as number] || WEBSITE_VERSION_NAME_MAP[WEBSITE_VERSION.FREE]
    d.is_loading = false
    d.is_independent = d.type === WEBSITE_TYPE_INDEPENDENT
    d.is_enterprise = d.type === WEBSITE_TYPE_ENTERPRISE
    d.is_industry = d.type === WEBSITE_TYPE_INDUSTRY
    d.is_install_wecom = (d.wecom_install_info as any)?.install_wecom_app
    d.wecom_info = (d.wecom_install_info as any)?.auth_corp_info || {}
    d.is_install_dingtalk = (d.dingtalk_auth_corp_info as any)?.install_dingtalk_app
    d.dingtalk_info = (d.dingtalk_auth_corp_info as any)?.auth_corp_info || {}

    return d as EnterpriseInfo
  },

  async loadListData({ data: { status = -1, offset = 0, limit = 500 }, hideError = false }) {
    const res: any = await enterpriseApi.saas_list({ status, offset, limit }, hideError ? {} : undefined)
    const { count = 0, details = [] } = res?.data || {}
    const list = details.map((item: any = {}) => get().getFormatEnterpriseData(item))
    return { count, list }
  },

  async apply({
    data: { contact_name = '', enterprise_name = '', domain = '', email = '', phone = '' },
    hideError = false,
  }) {
    return enterpriseApi.saas_apply(
      { contact_name, enterprise_name, domain, email, phone },
      hideError ? undefined : ({} as any),
    )
  },

  async loadDetailData({ data: { eid = '' }, hideError = false }) {
    const res: any = await enterpriseApi.saas_detail(eid, hideError ? {} : { 'X-My-Id': eid })
    const { access_token = '', enterprise = {} } = res?.data || {}
    if (access_token) {
      const userStore = useUserStore.getState()
      userStore.setAccessToken(access_token)
      userStore.setEid(eid)
    }
    return get().getFormatEnterpriseData(enterprise)
  },

  async loadSelfInfo() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : ''
    // 只检查 token 是否存在，不依赖 user_info.eid
    // 因为 user_info 可能在首次加载时还未被 user.loadSelfInfo() 更新
    if (!token) return get()

    try {
      const saasRes = await enterpriseApi.is_saas().catch(() => ({ data: {} }))
      const userStore = useUserStore.getState()
      userStore.setIsSaasLogin(saasRes.data.is_saas)

      const selfInfoRes = await enterpriseApi[saasRes.data.is_saas ? 'saas_self_info' : 'self_info']()
      const formattedInfo = get().getFormatEnterpriseData(selfInfoRes.data)
      set({ info: formattedInfo })

      // 并行加载版本信息，不阻塞主流程
      if (!isPrivatePrem()) {
        if (saasRes.data.is_saas) {
          get().loadVersionInfo().catch(() => {}) // 非阻塞
        } else {
          set({ version: { ...get().version, features: {} } })
        }
      } else {
        get().loadLicenseVersionInfo().catch(() => {}) // 非阻塞
      }

      const link = document.querySelector('link[rel="icon"]') || document.createElement('link')
      link.rel = 'icon'
      link.href = formattedInfo.ico || formattedInfo.logo || getDefaultLogo()
      if (!document.querySelector('link[rel="icon"]')) document.head.appendChild(link)

      eventBus.emit('enterprise-info-loaded', formattedInfo)
    } catch (error) {
      console.log(error)
    }

    return get()
  },

  async loadHomeInfo() {
    const res = await enterpriseApi.home_info()
    return res?.data || {}
  },

  async update({
    data: {
      eid,
      logo,
      ico,
      display_name,
      language,
      description,
      keywords,
      copyright,
      type,
      layout_type,
      template_type,
      domain = '',
      slogan = '',
    },
  }) {
    return enterpriseApi.update({
      eid,
      logo,
      ico,
      display_name,
      language: language || 'zh-cn',
      description,
      keywords,
      copyright,
      type,
      layout_type: layout_type || 'portal',
      template_type: template_type || '',
      domain,
      slogan,
    })
  },

  async loadVersionInfo() {
    const res: any = await saasApi.product.version().catch(() => ({ data: [] }))
    const data = res?.data || []
    const features: VersionFeatures = {}
    data.forEach((item: { feature_key: string; value: unknown }) => {
      if (item.feature_key) {
        features[item.feature_key] = { max: Number(item.value) }
      }
    })
    set({ version: { ...get().version, features } })
  },

  async loadLicenseVersionInfo() {
    const res: any = await licenseApi.features().catch(() => ({ data: [] }))
    const data = res?.data || []
    const features: VersionFeatures = {}
    data.forEach((item: { feature_key: string; value: unknown }) => {
      if (item.feature_key) {
        features[item.feature_key] = { max: Number(item.value) }
      }
    })
    set({ version: { ...get().version, features } })
  },

  async loadSMTPInfo() {
    const res: any = await enterpriseApi.smtp_config()
    return res?.data || {}
  },

  async loadSMTPDetail({ data: { type = '' } }) {
    const res: any = await enterpriseApi.smtp_detail(type)
    return res?.data || {}
  },

  async saveSMTPInfo({ data: { content = '', enabled = true, type = 'smtp' } }) {
    return enterpriseApi.smtp_save({ content, enabled, type })
  },

  async sendTestEmail({
    data: { from, host, is_ssl, password, port, to, username },
  }) {
    return enterpriseApi.smtp_send({
      from: from || '',
      host: host || '',
      is_ssl: is_ssl ?? true,
      password: password || '',
      port: port || '',
      to: to || '',
      username: username || '',
    })
  },
}))
