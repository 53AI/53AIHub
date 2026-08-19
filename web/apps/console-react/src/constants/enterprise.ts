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

export const ENTERPRISE_INDUSTRY = {
  AGRICULTURE: 'agriculture',
  MINING: 'mining',
  MANUFACTURING: 'manufacturing',
  ENERGY: 'energy',
  CONSTRUCTION: 'construction',
  WHOLESALE_RETAIL: 'wholesale_retail',
  TRANSPORTATION: 'transportation',
  HOSPITALITY: 'hospitality',
  INFORMATION_TECHNOLOGY: 'information_technology',
  FINANCE: 'finance',
  REAL_ESTATE: 'real_estate',
  LEASING_SERVICES: 'leasing_services',
  SCIENCE_TECHNOLOGY: 'science_technology',
  WATER_ENVIRONMENT: 'water_environment',
  RESIDENT_SERVICES: 'resident_services',
  EDUCATION: 'education',
  HEALTH_SOCIAL: 'health_social',
  CULTURE_SPORTS: 'culture_sports',
  PUBLIC_ADMINISTRATION: 'public_administration',
  INTERNATIONAL_ORGANIZATIONS: 'international_organizations',
} as const
export type EnterpriseIndustry =
  (typeof ENTERPRISE_INDUSTRY)[keyof typeof ENTERPRISE_INDUSTRY]

export const ENTERPRISE_INDUSTRY_LABEL_MAP = new Map<EnterpriseIndustry, string>([
  [ENTERPRISE_INDUSTRY.AGRICULTURE, 'module.industry_agriculture'],
  [ENTERPRISE_INDUSTRY.MINING, 'module.industry_mining'],
  [ENTERPRISE_INDUSTRY.MANUFACTURING, 'module.industry_manufacturing'],
  [ENTERPRISE_INDUSTRY.ENERGY, 'module.industry_energy'],
  [ENTERPRISE_INDUSTRY.CONSTRUCTION, 'module.industry_construction'],
  [ENTERPRISE_INDUSTRY.WHOLESALE_RETAIL, 'module.industry_wholesale_retail'],
  [ENTERPRISE_INDUSTRY.TRANSPORTATION, 'module.industry_transportation'],
  [ENTERPRISE_INDUSTRY.HOSPITALITY, 'module.industry_hospitality'],
  [
    ENTERPRISE_INDUSTRY.INFORMATION_TECHNOLOGY,
    'module.industry_information_technology',
  ],
  [ENTERPRISE_INDUSTRY.FINANCE, 'module.industry_finance'],
  [ENTERPRISE_INDUSTRY.REAL_ESTATE, 'module.industry_real_estate'],
  [ENTERPRISE_INDUSTRY.LEASING_SERVICES, 'module.industry_leasing_services'],
  [ENTERPRISE_INDUSTRY.SCIENCE_TECHNOLOGY, 'module.industry_science_technology'],
  [ENTERPRISE_INDUSTRY.WATER_ENVIRONMENT, 'module.industry_water_environment'],
  [ENTERPRISE_INDUSTRY.RESIDENT_SERVICES, 'module.industry_resident_services'],
  [ENTERPRISE_INDUSTRY.EDUCATION, 'module.industry_education'],
  [ENTERPRISE_INDUSTRY.HEALTH_SOCIAL, 'module.industry_health_social'],
  [ENTERPRISE_INDUSTRY.CULTURE_SPORTS, 'module.industry_culture_sports'],
  [
    ENTERPRISE_INDUSTRY.PUBLIC_ADMINISTRATION,
    'module.industry_public_administration',
  ],
  [
    ENTERPRISE_INDUSTRY.INTERNATIONAL_ORGANIZATIONS,
    'module.industry_international_organizations',
  ],
])

export const ENTERPRISE_INDUSTRY_OPTIONS: EnterpriseIndustry[] = [
  ENTERPRISE_INDUSTRY.AGRICULTURE,
  ENTERPRISE_INDUSTRY.MINING,
  ENTERPRISE_INDUSTRY.MANUFACTURING,
  ENTERPRISE_INDUSTRY.ENERGY,
  ENTERPRISE_INDUSTRY.CONSTRUCTION,
  ENTERPRISE_INDUSTRY.WHOLESALE_RETAIL,
  ENTERPRISE_INDUSTRY.TRANSPORTATION,
  ENTERPRISE_INDUSTRY.HOSPITALITY,
  ENTERPRISE_INDUSTRY.INFORMATION_TECHNOLOGY,
  ENTERPRISE_INDUSTRY.FINANCE,
  ENTERPRISE_INDUSTRY.REAL_ESTATE,
  ENTERPRISE_INDUSTRY.LEASING_SERVICES,
  ENTERPRISE_INDUSTRY.SCIENCE_TECHNOLOGY,
  ENTERPRISE_INDUSTRY.WATER_ENVIRONMENT,
  ENTERPRISE_INDUSTRY.RESIDENT_SERVICES,
  ENTERPRISE_INDUSTRY.EDUCATION,
  ENTERPRISE_INDUSTRY.HEALTH_SOCIAL,
  ENTERPRISE_INDUSTRY.CULTURE_SPORTS,
  ENTERPRISE_INDUSTRY.PUBLIC_ADMINISTRATION,
  ENTERPRISE_INDUSTRY.INTERNATIONAL_ORGANIZATIONS,
]

