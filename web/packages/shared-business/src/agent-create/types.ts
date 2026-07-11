import type {
  AgentType,
  ConfigKey,
  GroupOption,
  AgentFormData,
  Settings,
  CustomConfig,
  CompletionParams,
  FileParseConfig,
  ImageParseConfig,
  SuggestedQuestion,
  FieldItem,
  RelateAgent,
  ScopeItem,
  IAgentCreateAdapter,
} from './adapters/types'

// 重导出适配器类型
export type {
  AgentType,
  ConfigKey,
  GroupOption,
  AgentFormData,
  Settings,
  CustomConfig,
  CompletionParams,
  FileParseConfig,
  ImageParseConfig,
  SuggestedQuestion,
  FieldItem,
  RelateAgent,
  ScopeItem,
  IAgentCreateAdapter,
}

// ==================== 组件 Ref 类型 ====================

/** Agent 表单组件 Ref */
export interface AgentFormRef {
  save?: () => Promise<{ data?: { agent_id?: string } }>
  validateForm?: () => Promise<boolean>
  onChannelSave?: () => Promise<void>
}

// ==================== Channel 相关共享类型 ====================

/** 渠道配置数据（API 返回的 channel_config 结构） */
export interface ChannelConfigData {
  channel_id?: number | string
  key?: string
  base_url?: string
  models?: string[]
  model?: string
  config?: {
    agent_type: string
    [key: string]: any
  }
  [key: string]: any
}

/** 渠道表单状态（平台组件内部使用） */
export interface ChannelFormState {
  key: string
  base_url: string
  models: string[]
  model: string
  config: {
    agent_type: string
  }
}

// ==================== Store 相关类型 ====================

/** Store 状态 */
export interface AgentFormState {
  saving: boolean
  loading: boolean
  initializing: boolean
  agent_id: string | number
  agent_type: string
  form_data: AgentFormData
  agent_data: Record<string, any>
  group_options: GroupOption[]
  support_image: boolean
  is_new: boolean
  // 修改追踪
  initial_form_data: AgentFormData | null
  is_dirty: boolean
}

/** Store 操作方法 */
export interface AgentFormActions {
  setSaving: (saving: boolean) => void
  setLoading: (loading: boolean) => void
  setInitializing: (initializing: boolean) => void
  setAgentId: (id: string | number) => void
  setAgentType: (type: string) => void
  setFormData: (data: Partial<AgentFormData>) => void
  setAgentData: (data: Record<string, any>) => void
  setGroupOptions: (options: GroupOption[]) => void
  setSupportImage: (support: boolean) => void
  setIsNew: (isNew: boolean) => void
  reset: () => void
}

/** Store 完整类型 */
export type AgentFormStore = AgentFormState & AgentFormActions

// ==================== Hook 相关类型 ====================

/** useAgentForm 返回的类型 */
export interface UseAgentFormReturn {
  // 状态访问
  formData: AgentFormData
  agentType: string
  agentId: string | number
  isNew: boolean
  loading: boolean
  saving: boolean
  agentData: Record<string, any>
  groupOptions: GroupOption[]
  supportImage: boolean

  // 字段更新
  updateField: <K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => void
  updateFields: (updates: Partial<AgentFormData>) => void

  // Settings 更新
  updateSettings: (updates: Partial<Settings>) => void
  updateOpeningStatement: (statement: string) => void
  updateSuggestedQuestions: (questions: SuggestedQuestion[]) => void
  updateFileParse: (config: Partial<FileParseConfig>) => void
  updateImageParse: (config: Partial<ImageParseConfig>) => void

  // 字段管理
  updateInputFields: (fields: FieldItem[]) => void
  updateOutputFields: (fields: FieldItem[]) => void

  // 关联应用管理
  updateRelateAgents: (agents: RelateAgent[]) => void
  addRelateAgent: (agent: RelateAgent) => void
  removeRelateAgent: (agentId: string | number) => void
  updateRelateAgent: (agentId: string | number, updates: Partial<RelateAgent>) => void

  // CustomConfig 更新
  updateCustomConfig: (updates: Partial<CustomConfig>) => void

  // 基本信息更新
  updateName: (name: string) => void
  updateLogo: (logo: string) => void
  updateDescription: (description: string) => void
  updateGroupId: (groupId: number) => void
  updateUseCases: (useCases: any[]) => void

  // 其他方法
  setSupportImage: (support: boolean) => void
  setAgentType: (type: string) => void
  getSupportFile: () => boolean
}

// ==================== 默认值工厂函数 ====================

const DEFAULT_COMPLETION_PARAMS: CompletionParams = {
  temperature: 0.2,
  top_p: 0.75,
  presence_penalty: 0.5,
  frequency_penalty: 0.5,
}

const DEFAULT_FILE_PARSE: FileParseConfig = {
  enable: false,
}

const DEFAULT_IMAGE_PARSE: ImageParseConfig = {
  vision: false,
  enable: false,
}

/** 获取默认 Settings */
export function getDefaultSettings(): Settings {
  return {
    opening_statement: '',
    suggested_questions: [],
    file_parse: { ...DEFAULT_FILE_PARSE },
    image_parse: { ...DEFAULT_IMAGE_PARSE },
    relate_agents: [],
    input_fields: [],
    output_fields: [],
  }
}

/** 获取默认 CustomConfig */
export function getDefaultCustomConfig(): CustomConfig {
  return {
    agent_type: 'prompt',
    agent_mode: 'chat',
    provider_id: 0,
    channel_id: 0,
    tencent_bot_id: '',
    coze_workspace_id: '',
    coze_bot_id: '',
    coze_bot_url: '',
    app_builder_bot_id: '',
    chat53ai_agent_id: '',
    channel_config: {},
  }
}

/** 获取默认表单数据 */
export function getInitialFormData(): AgentFormData {
  return {
    logo: '',
    name: '',
    bot_id: '',
    description: '',
    group_id: 0,
    channel_type: 0,
    model: '',
    sort: 0,
    prompt: '',
    user_group_ids: [],
    subscription_group_ids: [],
    scopes: [],  // 默认空，新建模式时由 GroupSelect 设置默认值
    tools: [],
    use_cases: [],
    configs: {
      completion_params: { ...DEFAULT_COMPLETION_PARAMS },
    },
    custom_config: getDefaultCustomConfig(),
    settings: getDefaultSettings(),
    enable: true,
  }
}

/** 获取默认字段项 */
export function getDefaultFieldItem(): FieldItem {
  return {
    id: '',
    variable: '',
    label: '',
    type: 'string',
    required: false,
    desc: '',
  }
}

/** 获取默认 Store 状态 */
export function getInitialState(): AgentFormState {
  return {
    saving: false,
    loading: false,
    initializing: false,
    agent_id: 0,
    agent_type: 'prompt',
    form_data: getInitialFormData(),
    agent_data: {},
    group_options: [],
    support_image: false,
    is_new: false,
    initial_form_data: null,
    is_dirty: false,
  }
}
