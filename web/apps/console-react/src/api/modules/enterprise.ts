import service from '../config'
import { handleError } from '../errorHandler'

export const enterpriseApi = {
  // 判断是否为 SaaS 环境
  is_saas() {
    return service.get('/api/enterprises/is_saas').catch(handleError)
  },

  // SaaS 企业信息
  saas_self_info<T = unknown>() {
    return service.get<T>('/api/saas/enterprise/current').catch(handleError)
  },

  // 私有化企业信息
  self_info<T = unknown>() {
    return service.get<T>('/api/enterprises/current').catch(handleError)
  },

  // 首页信息
  home_info<T = unknown>() {
    return service.get<T>('/api/enterprises/homepage').catch(handleError)
  },

  // 更新企业信息
  update(data: {
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
  }) {
    const { eid, ...payload } = data
    return service.put(`/api/enterprises/${eid}`, payload).catch(handleError)
  },

  // 企业配置（SMTP/SSO）
  enterprise_config(type: 'smtp' | 'auth_sso') {
    return service.get(`/api/enterprise-configs/${type}`).catch(handleError)
  },

  save_enterprise_config(type: 'smtp' | 'auth_sso', params: { content: string; enabled: boolean }) {
    return service.post(`/api/enterprise-configs/${type}`, params).catch(handleError)
  },

  toggle_enterprise_config(type: 'smtp' | 'auth_sso') {
    return service.put(`/api/enterprise-configs/${type}/toggle`).catch(handleError)
  },

  // SMTP 相关
  smtp_config() {
    return service.get('/api/enterprise-configs').catch(handleError)
  },

  smtp_detail(type: string) {
    return service.get(`/api/enterprise-configs/${type}`).catch(handleError)
  },

  smtp_save(data: { content: string; enabled: boolean; type: 'smtp' | 'mobile' }) {
    const { type, ...payload } = data
    return service.post(`/api/enterprise-configs/${type}`, payload).catch(handleError)
  },

  smtp_send(data: {
    from: string
    host: string
    is_ssl: boolean
    password: string
    port: number | string
    to: string
    username: string
  }) {
    return service.post('/api/email/send_test', data).catch(handleError)
  },

  // 协议相关
  policy_info() {
    return service
      .get('/api/public/enterprise-info')
      .then(res => res.data)
      .catch(handleError)
  },

  save_policy_info(params: {
    terms_of_service: { enabled: boolean; url: string }
    privacy_policy: { enabled: boolean; url: string }
    ai_privacy_policy: { enabled: boolean; url: string }
  }) {
    return service.put('/api/enterprise-info', params).catch(handleError)
  },

  // SaaS 管理相关
  saas_list(params?: { status?: -1 | 0 | 1 | 2; offset?: number; limit?: number }, extraHeaders?: Record<string, string>) {
    return service.get('/api/saas/enterprise/applies', { params, headers: extraHeaders }).catch(handleError)
  },

  saas_apply(data: {
    contact_name: string
    enterprise_name: string
    domain: string
    email: string
    phone: string
  }) {
    return service.post('/api/saas/enterprise/apply', data).catch(handleError)
  },

  saas_detail(eid: string, extraHeaders?: Record<string, string>) {
    return service.get(`/api/saas/enterprise/${eid}`, { headers: extraHeaders }).catch(handleError)
  },
}

export default enterpriseApi
