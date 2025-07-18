export const VERSION_MODULE = {
  AGENT: 'agent',
  INDEPENDENT_DOMAIN: 'independent_domain',
  REGISTERED_USER: 'registered_user',
  INTERNAL_USER: 'internal_user'
} as const

export const WEBSITE_TYPE = {
  INDEPENDENT: 'independent',
  ENTERPRISE: 'enterprise',
  INDUSTRY: 'industry'
} as const

export const WEBSITE_VERSION = {
  // 创业版
  FREE: 1,
  // 专业版
  STANDARD: 2,
  // 企业版
  ENTERPRISE: 3
} as const

export const ENTERPRISE_SYNC_FROM = {
  DEFAULT: '0',
  WECOM: '1'
} as const

export const WEBSITE_TYPE_LABEL_MAP = new Map([
  [WEBSITE_TYPE.INDEPENDENT, 'module.website_type_independent'],
  [WEBSITE_TYPE.ENTERPRISE, 'module.website_type_enterprise'],
  [WEBSITE_TYPE.INDUSTRY, 'module.website_type_industry']
])

export const WEBSITE_TYPE_DESC_MAP = new Map([
  [WEBSITE_TYPE.INDEPENDENT, 'module.website_type_independent_desc'],
  [WEBSITE_TYPE.ENTERPRISE, 'module.website_type_enterprise_desc'],
  [WEBSITE_TYPE.INDUSTRY, 'module.website_type_industry_desc']
])

export const WEBSITE_VERSION_NAME_MAP = {
  [WEBSITE_VERSION.FREE]: 'free',
  [WEBSITE_VERSION.STANDARD]: 'standard',
  [WEBSITE_VERSION.ENTERPRISE]: 'enterprise'
}

export type VersionModule = (typeof VERSION_MODULE)[keyof typeof VERSION_MODULE]
export type WebsiteType = (typeof WEBSITE_TYPE)[keyof typeof WEBSITE_TYPE]
export type WebsiteVersion = (typeof WEBSITE_VERSION)[keyof typeof WEBSITE_VERSION]

export const ENTERPRISE_WECOM_SUITE_ID = 'wwdce32ea39893200f'

export type EnterpriseSyncFrom = (typeof ENTERPRISE_SYNC_FROM)[keyof typeof ENTERPRISE_SYNC_FROM]
