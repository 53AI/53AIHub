export const VERSION_MODULE = {
  AGENT: 'agent',
  PROMPT: 'prompt',
  AILINK: 'ai_link',
  INDEPENDENT_DOMAIN: 'independent_domain',
  REGISTERED_USER: 'registered_user',
  INTERNAL_USER: 'internal_user',
  WECOM: 'wecom',
  KNOWLEDGE_BASE: 'knowledge_base',
  LIBRARY_COUNT: 'library_count',
  SPACE_COUNT: 'space_count',
  DOCUMENT_COUNT: 'document_count',
  STORAGE_CAPACITY: 'storage_capacity',
  WORKBENCH: 'workbench',
  RECORDING: 'recording',
} as const
export type VersionModule = (typeof VERSION_MODULE)[keyof typeof VERSION_MODULE]

export const WEBSITE_TYPE = {
  INDEPENDENT: 'independent',
  ENTERPRISE: 'enterprise',
  INDUSTRY: 'industry',
} as const
export type WebsiteType = (typeof WEBSITE_TYPE)[keyof typeof WEBSITE_TYPE]

export const WEBSITE_VERSION = {
  // 创业版
  FREE: 1,
  // 专业版
  STANDARD: 2,
  // 企业版
  ENTERPRISE: 3,
  // 旗舰版
  FLAGSHIP: 4,
} as const
export type WebsiteVersion = (typeof WEBSITE_VERSION)[keyof typeof WEBSITE_VERSION]

export const ENTERPRISE_SYNC_FROM = {
  DEFAULT: '0',
  WECOM: '1',
  DINGTALK: '2',
} as const
export type EnterpriseSyncFrom = (typeof ENTERPRISE_SYNC_FROM)[keyof typeof ENTERPRISE_SYNC_FROM]

export const WEBSITE_TYPE_LABEL_MAP = new Map([
  [WEBSITE_TYPE.INDEPENDENT, 'module.website_type_independent'],
  [WEBSITE_TYPE.ENTERPRISE, 'module.website_type_enterprise'],
  [WEBSITE_TYPE.INDUSTRY, 'module.website_type_industry'],
])

export const WEBSITE_TYPE_DESC_MAP = new Map([
  [WEBSITE_TYPE.INDEPENDENT, 'module.website_type_independent_desc'],
  [WEBSITE_TYPE.ENTERPRISE, 'module.website_type_enterprise_desc'],
  [WEBSITE_TYPE.INDUSTRY, 'module.website_type_industry_desc'],
])

export const WEBSITE_VERSION_NAME_MAP = {
  [WEBSITE_VERSION.FREE]: 'free',
  [WEBSITE_VERSION.STANDARD]: 'standard',
  [WEBSITE_VERSION.ENTERPRISE]: 'enterprise',
  [WEBSITE_VERSION.FLAGSHIP]: 'flagship',
}

export const WEBSITE_STYLE = {
  WEBSITE: 'website',
  SOFTWARE: 'software',
} as const
export type WebsiteStyle = (typeof WEBSITE_STYLE)[keyof typeof WEBSITE_STYLE]

export const WEBSITE_STYLE_LABEL_MAP = new Map([
  [WEBSITE_STYLE.WEBSITE, 'template_style.website'],
  [WEBSITE_STYLE.SOFTWARE, 'template_style.software'],
])
export const WEBSITE_STYLE_DEMO_MAP = new Map([
  [WEBSITE_STYLE.WEBSITE, '/images/info/template-website.png'],
  [WEBSITE_STYLE.SOFTWARE, '/images/info/template-software.png'],
])

