import request from '../../index'

export interface RawEnterpriseInfo {
  enterprise: {
    id: number
    display_name: string
    logo: string
    ico: string
    keywords: string
    copyright: string
    type: string
    banner: string
    language: string
    timezone: string
    domain: string
    slogan: string
    status: number
    description: string
    template_type: string
    layout_type: string
    wecom_corp_id: string
    wecom_install_info: {
      install_wecom_app: number
      auth_corp_info: null
    }
    created_time: number
    updated_time: number
  }
  apply_info: {
    apply_id: number
    user_id: number
    phone: string
    email: string
    enterprise_name: string
    contact_name: string
    status: number
    reason: string
    version: number
    expired_time: number
    eid: number
    created_time: number
    updated_time: number
  }
  domains: {
    id: number
    eid: number
    domain: string
    type: number
    config: string
    created_time: number
    updated_time: number
  }[]
}

export interface EnterpriseListParams {
  status: -1 | 0 | 1 | 2 // (-1 for all) 0:待审核 1:已通过 2:已拒绝
  offset?: number
  limit?: number
}

export interface EnterpriseList {
  count: number
  details: RawEnterpriseInfo[]
}

export interface EnterpriseDetail {
  access_token: string
  enterprise: Record<string, any>
}

export interface EnterpriseFeature {
  feature_key: string
  value: boolean | number
}

export type EnterpriseFeatures = EnterpriseFeature[]

export interface InitRequest {
  enterprise: {
    enterprise_name: string
  }
  user: {
    account_name: string
    password: string
  }
  channel?: {
    type: number
    base_url?: string
    key: string
  }
}

export interface InitResponse {
  access_token: string
  user_id: number
}

export const enterpriseApi = {
  /**
   * 初始化安装
   * POST /api/init
   */
  init(data: InitRequest): Promise<InitResponse> {
    return request.post('/api/init', data).then((res) => res.data)
  },

  info(): Promise<RawEnterpriseInfo> {
    return request.get('/api/saas/enterprise/current').then((res) => res.data)
  },

  current() {
    return request.get('/api/enterprises/current').then((res) => res.data)
  },

  get(id: string) {
    return request.get(`/api/enterprises/${id}`)
  },

  getSMTPInfo(type: string) {
    return request.get(`/api/enterprise-configs/${type}/enabled`)
  },

  async update(
    id: number,
    data: {
      display_name: string
      logo: string
      language: string
      template_type: string
    }
  ) {
    return request.put(`/api/enterprises/${id}`, data)
  },

  saasList(info: EnterpriseListParams): Promise<EnterpriseList> {
    return request
      .get('/api/saas/enterprise/applies', {
        params: { access_token: localStorage.getItem('site_token'), ...info }
      })
      .then((res) => res.data)
  },

  saasDetail(eid: string): Promise<EnterpriseDetail> {
    return request
      .get(`/api/saas/enterprise/${eid}`, {
        params: { access_token: localStorage.getItem('site_token') },
        headers: { 'X-My-Id': eid }
      })
      .then((res) => res.data)
  },

  is_saas() {
    return request.get('/api/enterprises/is_saas')
  },

  // 获取服务协议、隐私协议、AI隐私协议
  policy_info() {
    return request.get(`/api/public/enterprise-info`)
  },

  features(): Promise<EnterpriseFeatures> {
    return request.get('/api/enterprises/features').then((res) => res.data)
  }
}

export default enterpriseApi
