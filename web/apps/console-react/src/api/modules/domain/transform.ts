import {
  DOMAIN_CONFIG,
  INDEPENDENT_RESOLVE_TYPE,
  INDEPENDENT_SSL_CERT_TYPE,
} from '@/constants/domain'
import type {
  DomainListResponse,
  RawDomainListResponse,
  IndependentDomainConfig,
  IndependentDomainData,
  ExclusiveDomainData,
  DomainConfig,
  DomainData,
} from './types'

export const getDefaultIndependentConfig = (): IndependentDomainConfig => ({
  resolve_type: INDEPENDENT_RESOLVE_TYPE.CNAME,
  enable_https: DOMAIN_CONFIG.DEFAULT_ENABLE_HTTPS,
  force_https: DOMAIN_CONFIG.DEFAULT_FORCE_HTTPS,
  ssl_cert_type: INDEPENDENT_SSL_CERT_TYPE['53AI'],
  ssl_certificate: '',
  ssl_private_key: '',
  use_subdir: DOMAIN_CONFIG.DEFAULT_USE_SUBDIR,
  subdir: DOMAIN_CONFIG.DEFAULT_SUBDIR,
})

export const getDefaultIndependentDomain = (): IndependentDomainData => ({
  domain: '',
  config: getDefaultIndependentConfig(),
})

export const getDefaultExclusiveDomain = (): ExclusiveDomainData => ({
  domain: '',
})

export function transformDomainList(rawData: RawDomainListResponse): DomainListResponse {
  try {
    return {
      exclusive_domains: (rawData as any).exclusive_domains || [],
      independent_domains: (rawData as any).independent_domains || [],
    }
  } catch (error) {
    console.error('转换域名列表数据失败:', error)
    return {
      exclusive_domains: [],
      independent_domains: [],
    }
  }
}

export function validateIndependentConfig(config: Partial<IndependentDomainConfig>): boolean {
  if (config.enable_https && config.ssl_cert_type === INDEPENDENT_SSL_CERT_TYPE.CUSTOM) {
    return !!(config.ssl_certificate && config.ssl_private_key)
  }

  if (config.use_subdir) {
    return !!(config.subdir && config.subdir.trim())
  }

  return true
}

export function formatDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim()
}

export function processExclusiveDomainData(domainData: DomainData) {
  if ((domainData as any).domain) {
    return `https://${(domainData as any).domain}`
  }
  return ''
}

export function processIndependentDomainData(domainData: DomainData) {
  const rawData = { ...(domainData as any) }

  let config: DomainConfig = {}
  if ((domainData as any).config) {
    try {
      config =
        typeof (domainData as any).config === 'string'
          ? JSON.parse((domainData as any).config)
          : ((domainData as any).config as any)
    } catch (error) {
      console.error('解析独立域名配置失败:', error)
      config = {}
    }
  }

  rawData.config = config

  const domainName = String((domainData as any).domain || '').trim().replace(/^https?:\/\//, '')
  const httpsEnabled = Boolean(Number((config as any).enable_https))

  if (!domainName) return ''
  return `http${httpsEnabled ? 's' : ''}://${domainName}`
}

