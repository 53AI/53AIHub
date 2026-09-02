/**
 * Agent Create 模块统一类型定义
 */

import type { AgentType } from '@/constants/platform/config'

// ============ 渠道配置 ============

export interface ChannelConfig {
  channel_type?: number
  channel_id?: number
  name?: string
  label?: string
  value?: string
  key?: string
  base_url?: string
  models?: string[]
  model?: string
  config?: Record<string, any>
}

// ============ 自定义配置 ============

export interface CustomConfig {
  agent_type: string
  agent_mode: string
  provider_id: number
  channel_id: number
  tencent_bot_id: string
  coze_workspace_id: string
  coze_bot_id: string
  coze_bot_url: string
  app_builder_bot_id: string
  chat53ai_agent_id: string
  channel_config: Record<string, any>
  file_parse?: {
    enable: boolean
  }
  image_parse?: {
    enable: boolean
  }
}

// ============ 设置 ============

export interface SuggestedQuestion {
  id: number | string
  content: string
}

export interface FileParseConfig {
  enable: boolean
}

export interface ImageParseConfig {
  vision: boolean
  enable: boolean
}

export interface Settings {
  opening_statement: string
  suggested_questions: SuggestedQuestion[]
  file_parse: FileParseConfig
  image_parse: ImageParseConfig
  relate_agents: RelateAgent[]
  input_fields: FieldItem[]
  output_fields: FieldItem[]
}

// ============ 表单数据 ============

export interface FormData {
  logo: string
  name: string
  group_id: number
  description: string
  channel_type: number
  model: string
  sort: number
  prompt: string
  user_group_ids: number[]
  subscription_group_ids: number[]
  tools: any[]
  use_cases: UseCase[]
  configs: Record<string, any>
  custom_config: CustomConfig
  settings: Settings
  enable?: boolean
}

// ============ 分组选项 ============

export interface GroupOption {
  value: number
  label: string
  group_id: number
  group_name: string
}

// ============ 使用案例/场景 ============

export interface UseCase {
  id: string
  type: 'case' | 'scene'
  input_text?: string
  output_text?: string
  image?: string
  scene?: string
  desc?: string
}

// ============ 字段配置 ============

export interface FieldOption {
  id: string
  label: string
  value: string
}

export interface FieldItem {
  id: string
  variable: string
  label: string
  type: string
  desc: string
  required: boolean
  max_length: number
  show_word_limit: boolean
  options: FieldOption[]
  multiple: boolean
  date_format: string
  file_type: string
  file_accept: string[]
  file_limit: number
  file_size: number
  is_system: boolean
}

// ============ 关联应用 ============

export interface RelateAgentInputField {
  id: string
  type: string
  label: string
  variable: string
  required?: boolean
}

export interface RelateAgent {
  agent_id: number
  id: string
  name: string
  logo: string
  description?: string
  input_fields: RelateAgentInputField[]
  field_mapping: Record<string, string>
  execution_rule: 'auto' | 'manual'
  is_workflow?: boolean
}

// ============ 请求限制 ============

export interface RequestLimit {
  frequency: {
    enable: boolean
    interval: number
    number: number
    over_message: string
  }
  total: {
    enable: boolean
    limit: number
    over_message: string
  }
}

// ============ Store 状态 ============

export interface AgentFormState {
  saving: boolean
  loading: boolean
  initializing: boolean
  agent_id: number
  agent_type: string
  form_data: FormData
  agent_data: Record<string, any>
  group_options: GroupOption[]
  support_image: boolean
  is_new: boolean

  // Computed/getter-like properties (as functions)
  getAgentOptionData: () => any
  getSupportFile: () => boolean
  getIsIndependent: () => boolean

  // Actions
  loadDetailData: () => Promise<void>
  updateFormData: () => void
  loadGroupOptions: () => Promise<void>
  resetState: () => void
  saveAgentData: (options?: { hideToast?: boolean }) => Promise<Record<string, any>>

  // 新增：统一状态更新方法
  updateSettings: (updates: Partial<Settings>) => void
  updateCustomConfig: (updates: Partial<CustomConfig>) => void
  updateInputFields: (fields: FieldItem[]) => void
  updateOutputFields: (fields: FieldItem[]) => void
  updateRelateAgents: (agents: RelateAgent[]) => void
}

// ============ 组件 Props ============

export interface AgentTypeOption {
  icon?: string
  label: string
  description: string
  value: string
}

export interface PlatformProps {
  showChannelConfig?: boolean
  className?: string
}

export interface PlatformRef {
  save?: () => Promise<{ data?: { agent_id?: string } }>
  validateForm?: () => Promise<boolean>
  onChannelSave?: () => Promise<void>
}

// ============ Drawer 相关 ============

export interface AgentDrawerRef {
  open: (params?: OpenParams) => void
  close: () => void
  handleSave: () => Promise<void>
}

export interface OpenParams {
  agent_type?: AgentType
  data?: {
    channel_config?: ChannelConfig
    label?: string
    value?: string
  }
  agent_id?: number
  group_id?: number
  cache?: boolean
}

// ============ 预览相关 ============

export interface AgentPreviewRef {
  open: () => void
}

export interface ChatRef {
  restart: (options?: { saveAction?: boolean }) => void
  getIsConfigChanged: () => boolean
}

export interface CompletionRef {
  restart: () => void
}

// ============ 默认值 ============

export const DEFAULT_COMPLETION_PARAMS = {
  temperature: 0.2,
  top_p: 0.75,
  presence_penalty: 0.5,
  frequency_penalty: 0.5,
}

export const getInitialFormData = (): FormData => ({
  logo: '',
  name: '',
  group_id: 0,
  description: '',
  channel_type: 0,
  model: '',
  sort: 0,
  prompt: '',
  user_group_ids: [],
  subscription_group_ids: [],
  tools: [],
  use_cases: [],
  configs: { completion_params: DEFAULT_COMPLETION_PARAMS },
  custom_config: {
    agent_type: 'prompt',
    agent_mode: 'chat',
    provider_id: 0,
    channel_id: 0,
    coze_workspace_id: '',
    coze_bot_id: '',
    coze_bot_url: '',
    tencent_bot_id: '',
    app_builder_bot_id: '',
    chat53ai_agent_id: '',
    channel_config: {},
  },
  settings: {
    opening_statement: '',
    suggested_questions: [],
    file_parse: {
      enable: false,
    },
    image_parse: {
      vision: false,
      enable: false,
    },
    relate_agents: [],
    input_fields: [],
    output_fields: [],
  },
})

export const getDefaultFieldItem = (): FieldItem => ({
  id: '',
  variable: '',
  label: '',
  type: 'text',
  desc: '',
  required: false,
  max_length: 0,
  show_word_limit: false,
  options: [],
  multiple: false,
  date_format: '',
  file_type: 'all',
  file_accept: [],
  file_limit: 1,
  file_size: 30,
  is_system: false,
})
