import { RawEnterpriseInfo } from './types'
import { JSONParse } from '@km/shared-utils'
import { WEBSITE_VERSION, WEBSITE_VERSION_NAME_MAP } from '@/constants/enterprise'

export const WEBSITE_TYPE_INDEPENDENT = 'independent'
export const WEBSITE_TYPE_ENTERPRISE = 'enterprise'
export const WEBSITE_TYPE_INDUSTRY = 'industry'

const default_logo = '/images/default_logo.png'

export const transformEnterpriseInfo = (data: RawEnterpriseInfo): RawEnterpriseInfo => {
  return {
    ...data,
    enterprise: {
      ...data.enterprise,
      keywords: JSONParse(data.enterprise.keywords || '', []),
      banner: JSONParse(data.enterprise.banner || '', []),
      template_type: JSONParse(data.enterprise.template_type || '', {}),
      logo: data.enterprise.logo || default_logo
    },
  }
}

export const getDefaultLogo = () => '/images/default_logo.png'

export const getFormatEnterpriseData = (info = {}) => {
  let data = JSON.parse(JSON.stringify(info))
  data.apply = data.apply || data.apply_info || {}
  data.domains = data.domains || []
  data.enterprise = data.enterprise || {}
  data = {
    ...data,
    ...data.enterprise,
  }
  data.eid = data.eid || data.apply.eid || data.enterprise.id || ''
  data.logo = data.logo || data.enterprise.logo || getDefaultLogo()
  data.description = data.description || data.enterprise.description || ''
  data.domain = data.domain || (data.domains[0] || {}).domain || ''
  if (data.domain) data.domain = `https://${data.domain.replace(/^https?:\/\//, '')}`
  data.apply_id = data.apply.apply_id || data.apply.id || ''
  data.apply_name = data.apply.enterprise_name || ''
  data.name = data.name || data.enterprise.display_name || data.apply_name || ''
  data.is_process = data.apply.status == 0
  data.is_reject = data.apply.status == 2
  data.reject_reason = data.apply.reject_reason || data.apply.reason || ''
  data.expired_time = data.apply.expired_time || 0
  data.is_expired = data.expired_time ? data.expired_time < Date.now() : false
  data.version = +data.version || +data.apply.version || 1
  data.version_name =
    WEBSITE_VERSION_NAME_MAP[data.version] || WEBSITE_VERSION_NAME_MAP[WEBSITE_VERSION.FREE]
  data.is_loading = false
  data.is_independent = data.type === WEBSITE_TYPE_INDEPENDENT
  data.is_enterprise = data.type === WEBSITE_TYPE_ENTERPRISE
  data.is_industry = data.type === WEBSITE_TYPE_INDUSTRY
  data.is_install_wecom = data.wecom_install_info?.install_wecom_app
  data.wecom_info = data.wecom_install_info?.auth_corp_info || {}

  return data
}
