import type { ProviderValueType } from '@/constants/platform'

export interface RawProviderItem {
  provider_id: number
  eid: number
  name: string
  provider_type: number
  configs: string
  is_authorized: boolean
  access_token: string
  refresh_token: string
  expires_in: number
  authed_time: number
  base_url: string
  created_time: number
  updated_time: number
}

export interface ProviderItem extends Omit<RawProviderItem, 'configs'> {
  configs: Record<string, string>
  provider_icon: string
  provider_label: string
}

export interface ProviderCreateRequest {
  provider_type: ProviderValueType
  name: string
  access_token: string
  base_url: string
  configs: string
}

export interface ProviderUpdateRequest extends ProviderCreateRequest {}

