export namespace Enterprise {
  export interface Banner {
    url_list: string[]
    interval: string
  }

  export interface ApplyInfo {
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

  export interface State {
    id: number
    display_name: string
    logo: string
    ico: string
    keywords: string[]
    copyright: string
    type: string
    banner: string
    language: string
    timezone: string
    domain: string
    slogan: string
    status: number
    description: string
    banner_info: Banner
    template_type: string
    layout_type: string
    created_time: number
    updated_time: number
    template_style_info: {
      [key: string]: any
      style_type: 'software' | 'website'
    }
    is_independent: boolean
    is_enterprise: boolean
    is_industry: boolean
    is_install_wecom: boolean
    version: number
    features: {
      [key: string]: any
    }
    apply_info?: ApplyInfo
  }
}
