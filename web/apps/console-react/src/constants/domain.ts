import { domain_suffix } from '@/utils/config'

export const INDEPENDENT_RESOLVE_TYPE = {
  CNAME: 1,
  CUSTOM: 2,
} as const

export type IndependentResolveType =
  (typeof INDEPENDENT_RESOLVE_TYPE)[keyof typeof INDEPENDENT_RESOLVE_TYPE]

export const INDEPENDENT_SSL_CERT_TYPE = {
  '53AI': 1,
  CUSTOM: 2,
} as const

export type IndependentSslCertType =
  (typeof INDEPENDENT_SSL_CERT_TYPE)[keyof typeof INDEPENDENT_SSL_CERT_TYPE]

export const DOMAIN_CONFIG = {
  DEFAULT_ENABLE_HTTPS: true,
  DEFAULT_FORCE_HTTPS: false,
  DEFAULT_USE_SUBDIR: false,
  DEFAULT_SUBDIR: '',
} as const

export const DOMAIN_TYPE = {
  EXCLUSIVE: 'exclusive',
  INDEPENDENT: 'independent',
} as const

export type DomainType = (typeof DOMAIN_TYPE)[keyof typeof DOMAIN_TYPE]

export const DOMAIN_SUFFIX = domain_suffix

