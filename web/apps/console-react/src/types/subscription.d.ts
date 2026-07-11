export interface PricingInfo {
  amount: string | number
  currency: string
  relation_id: number
  time_unit: string
  type: number
}

export interface SubscriptionAgent {
  logo: string
  name: string
}

export interface SubscriptionItem {
  delete: boolean
  group_id: number
  setting_id: number
  ai_enabled: boolean
  sort: number
  group_name: string
  logo_url: string
  relations: PricingInfo[]
  year_info: PricingInfo
  month_info: PricingInfo
  point_month_info: PricingInfo
  agents: SubscriptionAgent[]
  is_default?: boolean
  target_group_id?: number
}

export interface UnitOption {
  value: string
  label: string
}

export interface AdvancedAgentOption {
  icon: string
  label: string
  includes: string[]
}

export interface SubscriptionSaveData {
  items: SubscriptionItem[]
}

export interface GroupOptionItem {
  value: number
  label: string
  icon?: string
}
