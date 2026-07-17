export interface ChannelRequestData {
  base_url: string
  config: string
  key: string
  custom_config: string
  model_mapping: string
  model_type: number
  models: string
  name: string
  other: string
  priority: number
  provider_id: number
  type: number
  weight: number
}

export interface ChannelTestResponse {
  success: boolean
  message: string
  time?: number
}
