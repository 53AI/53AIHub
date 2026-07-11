export interface MyAgentRequest {
  name: string
  description?: string
  logo?: string
  channel_type?: number
  agent_type?: number
  prompt?: string
  configs?: string
  tools?: string
  use_cases?: string
  settings?: string
  custom_config?: string
  model?: string
  enable?: boolean
}
