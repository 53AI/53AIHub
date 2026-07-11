import type { IndependentResolveType, IndependentSslCertType } from '@/constants/domain'

export interface DomainInfo {
  domain_id?: number
  domain: string
  status?: number
  created_time?: string
  updated_time?: string
}

export interface IndependentDomainConfig {
  resolve_type: IndependentResolveType
  enable_https: boolean
  force_https: boolean
  ssl_cert_type: IndependentSslCertType
  ssl_certificate: string
  ssl_private_key: string
  use_subdir: boolean
  subdir: string
}

export interface IndependentDomainData {
  domain: string
  config: IndependentDomainConfig
}

export interface ExclusiveDomainData {
  domain: string
}

export interface DomainListResponse {
  exclusive_domains?: DomainInfo[]
  independent_domains?: DomainInfo[]
}

export type RawDomainListResponse = DomainListResponse | Record<string, unknown>

export type DomainConfig = {
  enable_https?: string | number
  [key: string]: unknown
}

export type DomainData = {
  id?: number
  domain?: string
  domain_name?: string
  config?: string | DomainConfig
  [key: string]: unknown
}

export type IndependentDomainInfo = {
  httpsEnabled: boolean
  domainName: string
  rawData: DomainInfo
}
