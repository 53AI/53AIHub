import type { ReactNode, ComponentType } from 'react'
import type { KnowledgeSourceConfig } from '../hooks/useAgentPreviewSender'

// ==================== 添加弹框类型 ====================

/** 智能体类型选项（助理型/对话型/应用型） */
export interface AgentTypeOption {
  label: string
  value: string
  icon: string
  desc: string
  subLabel?: string
  disabled?: boolean
  agent_type: number
  agent_mode: string
}

/** 智能体平台选项 */
export interface AgentPlatformOption {
  label: string
  value: string
  icon: string
  channel_type: number
  agent_type: number
  agent_mode: string
  agent_usage?: number  // 新增可选字段
  hidden?: boolean
}

/** 创建弹框返回结果 */
export interface CreateAgentDialogResult {
  agentType: string
  name: string
  description: string
  logo: string
  groupId?: number
  backend_agent_type: number
  agent_mode?: string
}

/** 头像上传 slot props */
export interface AvatarSlotProps {
  value: string
  onChange: (logo: string) => void
}

/** 创建弹框 Props */
export interface CreateAgentDialogProps {
  visible: boolean
  onClose: () => void
  onConfirm: (data: CreateAgentDialogResult) => void
  types?: AgentTypeOption[]
  platformsByType: AgentPlatformOption[]
  groupValue?: number
  onGroupChange?: (value: number) => void
  groupOptions?: Array<{ label: string; value: number }>
  avatarSlot?: (props: AvatarSlotProps) => React.ReactNode
  t?: (key: string, params?: Record<string, any>) => string
}

// ==================== 基础类型 ====================

/** 平台类型 */
export type AgentType = string

/** 配置项 key */
export type ConfigKey =
  | 'model'
  | 'prompt'
  | 'tools'
  | 'relate_agents'
  | 'input_fields'
  | 'output_fields'
  | 'file_parse'
  | 'image_parse'
  | 'opening_statement'
  | 'suggested_questions'

/** 分组选项 */
export interface GroupOption {
  value: number
  label: string
}

// ==================== Scope 相关类型 ====================

/** 可见范围项 */
export interface ScopeItem {
  scope_type: 'company' | 'department' | 'user' | 'group';
  target_id: number;
}

// ==================== 模型选择器相关类型 ====================

/** 模型选项（供 ModelSelect 使用） */
export interface ModelOption {
  value: string
  model_value: string
  label: string
  icon?: string
  vision?: boolean
}

/** 渠道选项（供 ModelSelect 使用） */
export interface ChannelOption {
  value: string
  label: string
  icon?: string
  options: ModelOption[]
}

// ==================== 表单数据类型 ====================

/** 完成参数配置 */
export interface CompletionParams {
  temperature?: number
  top_p?: number
  presence_penalty?: number
  frequency_penalty?: number
}

/** 文件解析配置 */
export interface FileParseConfig {
  enable: boolean
}

/** 图片解析配置 */
export interface ImageParseConfig {
  vision: boolean
  enable: boolean
}

/** 建议问题 */
export interface SuggestedQuestion {
  id: number | string
  content: string
}

/** 字段项 */
export interface FieldItem {
  id: string
  variable: string
  label: string
  type: string
  desc?: string
  required?: boolean
  max_length?: number
  show_word_limit?: boolean
  options?: { id: string; label: string; value: string }[]
  multiple?: boolean
  file_accept?: string | string[]
  file_limit?: number
  file_size?: number
  date_format?: string
  file_type?: string
  is_system?: boolean
  default?: any
  description?: string
}

/** 关联智能体 */
export interface RelateAgent {
  agent_id: string | number
  id?: string
  name: string
  logo?: string
  description?: string
  input_fields?: {
    id: string
    type: string
    label: string
    variable: string
    required?: boolean
  }[]
  field_mapping?: Record<string, string>
  execution_rule?: 'auto' | 'manual'
  is_workflow?: boolean
}

/** Settings 配置 */
export interface Settings {
  opening_statement: string
  suggested_questions: SuggestedQuestion[]
  file_parse: FileParseConfig
  image_parse: ImageParseConfig
  relate_agents: RelateAgent[]
  input_fields: FieldItem[]
  output_fields: FieldItem[]
  [key: string]: any
}

/** 自定义配置 */
export interface CustomConfig {
  agent_type?: string
  agent_mode?: string
  provider_id?: number
  channel_id?: number
  tencent_bot_id?: string
  coze_workspace_id?: string
  coze_bot_id?: string
  coze_bot_url?: string
  app_builder_bot_id?: string
  chat53ai_agent_id?: string
  channel_config?: Record<string, any>
  [key: string]: any
}

/** 表单数据 */
export interface AgentFormData {
  agent_id?: string | number
  bot_id?: string
  logo: string
  name: string
  description: string
  group_id: number
  channel_type: number
  model: string
  sort: number
  prompt: string
  user_group_ids: number[]
  subscription_group_ids: number[]
  scopes?: ScopeItem[]  // 新增：可见范围
  tools: any[]
  use_cases: any[]
  configs: Record<string, any>
  custom_config: CustomConfig
  settings: Settings
  enable?: boolean
  // 时间戳
  created_time?: number
  updated_time?: number
}

// ==================== UI 组件类型 ====================

/** 页面布局 Props */
export interface PageLayoutProps {
  header?: {
    title: string
    back?: boolean
    titlePrefix?: ReactNode
  }
  footer?: ReactNode
  children: ReactNode
  contentClassName?: string
  scrollable?: boolean
}

/** 模型选择器 Props */
export interface ModelSelectProps {
  value?: string
  onChange: (value: string, option: any) => void
  valueKey?: string
  className?: string
  style?: React.CSSProperties
}

/** 分组选择器 Props */
export interface GroupSelectProps {
  value?: number
  onChange: (value: number) => void
  options: GroupOption[]
  className?: string
  style?: React.CSSProperties
}

// ==================== 适配器接口 ====================

/**
 * Agent 创建模块适配器接口
 *
 * 用于抽象不同应用之间的差异：
 * - API 端点（管理端 vs 用户端）
 * - 平台支持范围
 * - 配置项可见性
 * - UI 组件注入
 */
export interface IAgentCreateAdapter {
  // ========== 能力声明 ==========

  /** 支持的平台类型列表 */
  supportedPlatforms: AgentType[]

  /** 默认平台（新建时使用） */
  defaultPlatform: AgentType

  /** 可见的配置项 */
  visibleConfigKeys?: ConfigKey[]

  // ========== API 操作 ==========

  /** 获取 Agent 详情 */
  getDetail: (agentId: string | number) => Promise<AgentFormData>

  /** 保存 Agent（创建或更新） */
  save: (data: AgentFormData) => Promise<AgentFormData>

  /** 获取分组选项（可选） */
  getGroupOptions?: () => Promise<GroupOption[]>

  /** 删除 Agent（可选） */
  delete?: (agentId: string | number) => Promise<void>

  // ========== 数据转换 ==========

  /** 提交前过滤/转换表单数据 */
  filterFormData?: (data: AgentFormData) => AgentFormData

  /** 展示前过滤/转换响应数据 */
  filterResponseData?: (data: AgentFormData) => AgentFormData

  /** 详情数据加载完成后的回调（用于同步到本地 store） */
  onDetailLoaded?: (data: AgentFormData) => void

  // ========== 平台配置 ==========

  /** 获取平台特定配置（如 Coze workspaces） */
  getPlatformConfig?: (params: {
    platform: AgentType
    type?: string
    provider_id?: number
    workspace_id?: string
    channel_id?: number
    bot_id?: string | number
    agent_id?: string | number
    group_id?: number
    keyword?: string
    offset?: number
    limit?: number
  }) => Promise<any>

  /** 获取平台显示配置（图标、名称等） */
  getAgentConfig?: (platform: AgentType) => {
    icon?: string
    name?: string
    channelName?: string
    channelType?: number
    mode?: string
  }

  /** 保存渠道配置 */
  saveChannel?: (data: {
    channel_id?: number
    key: string
    base_url: string
    config: Record<string, any>
    models: string[]
    name: string
  }) => Promise<any>

  /** 获取智能体列表 */
  getAgentList?: (params: {
    group_id?: number
    keyword?: string
    offset?: number
    limit?: number
  }) => Promise<{ count: number; agents: any[] }>

  /**
   * 获取智能体已配置的模型列表（preview 用）
   * 返回的 items 每条带后端分配的独立 `id` 字段，preview 按 value 匹配后取真实 modelId，
   * 对齐 apps/front-react/src/views/knowledge/chat.tsx 行 435 的
   * `modelId = currentModel?.id` 语义。
   */
  getAgentModels?: (agentId: string | number) => Promise<Array<{
    id: string | number
    channel_id: number
    channel_type: number
    model: string
    [key: string]: any
  }>>

  /** 加载模型列表（供 ModelSelect 使用） */
  loadModels?: () => Promise<ChannelOption[]>

  /** 加载重排序模型列表 */
  loadRerankModels?: () => Promise<ChannelOption[]>

  // ========== UI 组件注入 ==========

  /** 页面布局组件 */
  PageLayout?: ComponentType<PageLayoutProps>

  /** Agent 表单组件（动态加载不同平台） */
  AgentFormComponent?: ComponentType<{
    agentType: AgentType
    showChannelConfig?: boolean
    className?: string
    ref?: any
  }>

  // ========== 工具函数注入 ==========

  /** 翻译函数 */
  t?: (key: string, params?: Record<string, any>) => string

  /** 生成随机 ID */
  generateRandomId?: (length: number) => string

  /** 图片上传组件 */
  ImageUploadComponent?: ComponentType<{
    className?: string
    value?: string
    onChange?: (url: string) => void
  }>

  /** 复制到剪贴板 */
  copyToClip?: (text: string) => Promise<boolean>

  /** 获取公共路径 */
  getPublicPath?: (path: string) => string

  /** API Host */
  apiHost?: string

  /** Markdown 编辑器配置 */
  markdownEditorConfig?: {
    cdn: string
    apiHost: string
    accessToken?: string
  }

  // ========== 企业信息 ==========

  /** 是否为独立部署 */
  isIndependent?: boolean

  /** 是否为行业版 */
  isIndustry?: boolean

  /** 是否为企业版 */
  isEnterprise?: boolean

  /**
   * 是否隐藏知识图谱入口（设置面板中的开关 + 预览下拉项）
   * 本地版（VITE_PLATFORM=op-local）与私有化版（VITE_PRIVATE_PREM=true）需要隐藏。
   * 由消费方根据环境变量在 adapter 中设置。
   */
  hideKnowledgeGraph?: boolean

  // ========== 分组类型常量 ==========

  /** 分组类型常量 */
  GROUP_TYPE?: {
    USER: string
    INTERNAL_USER: string
    AGENT: string
  }

  // ========== 分组选择组件 ==========

  /** 分组选择组件 */
  GroupSelectComponent?: ComponentType<{
    value?: number | number[] | ScopeItem[]
    onChange?: (value: number | number[] | ScopeItem[]) => void
    type?: 'select' | 'checkbox' | 'picker' | 'radio' | 'scope'
    groupType?: string
    multiple?: boolean
    defaultFirst?: boolean
    defaultFirstValue?: boolean
    defaultAll?: boolean
    simpleValue?: boolean
    onOptionsLoad?: (options: any[]) => void
    children?: React.ReactNode
  }>

  // ========== 分组标签组件 ==========

  /** 分组标签组件（用于筛选） */
  GroupTabsComponent?: ComponentType<{
    value: number
    onChange?: (value: number | string) => void
    groupType?: string
  }>

  // ========== Preview / 调试预览 ==========

  /** 预览面板组件（Drawer 形式） */
  PreviewComponent?: ComponentType<{
    ref?: any
  }>

  /** 内联预览组件（直接嵌入页面，用于第三列） */
  InlinePreviewComponent?: ComponentType<{
    className?: string
  }>

  /** OpenClaw 内联调试组件（复用正式 OpenClaw 对话工作台） */
  OpenClawPreviewComponent?: ComponentType<{
    className?: string
  }>

  /** 使用范围组件（注册用户/内部用户分组选择，仅管理端需要） */
  UseScopeComponent?: ComponentType<{}>

  /** 技能选择器组件（用于小助理技能配置） */
  SkillPickerComponent?: ComponentType<{
    value?: any[]
    onChange?: (skills: any[]) => void
    disabled?: boolean
    /** 翻译函数 */
    translate?: (key: string) => string
  }>

  // ========== Agent 内置技能绑定 API ==========

  /** 获取 Agent 内置技能列表 */
  getAgentBuiltinSkills?: (agentId: string | number) => Promise<Array<{
    skill_id: string
    skill_library_id: number
    display_name: string
    skill_name?: string
    logo?: string
    description?: string
  }>>

  /** 添加内置技能绑定 */
  addAgentBuiltinSkill?: (agentId: string | number, skillLibraryId: number) => Promise<{
    skill_id: string
    skill_library_id: number
    display_name: string
    skill_name?: string
    logo?: string
    description?: string
  }>

  /** 删除内置技能绑定 */
  deleteAgentBuiltinSkill?: (agentId: string | number, bindingId: number) => Promise<void>

  // ========== 会话/预览相关 API ==========

  /** AGENT_TYPES 常量 */
  AGENT_TYPES?: Record<string, string>

  /** 创建会话 */
  createConversation?: (data: { agent_id: string | number; title?: string; conversation_type?: number }) => Promise<{ conversation_id: string | number }>

  /** 发送聊天消息 */
  sendChatMessage?: (params: {
    conversation_id: string | number
    messages: any[]
    agent_id: string | number
    agent_configs?: Record<string, any>

    /**
     * 场景标识，影响 adapter 构造的 payload 形态：
     * - 'agent'    普通智能体 → minimal 模式（不带 enable_process_steps / knowledge_base_ids 等）
     * - 'work-ai'  工作台 AI → full 模式 + skill 前缀
     * - ''         知识库/AI 搜问 → full 模式 + modelId 后缀 + library/search/graph
     */
    type?: 'work-ai' | 'agent' | ''
    /**
     * 强制 minimal 模式（不带 enable_process_steps / knowledge_base_ids 等），
     * 等价于 type='agent'。后端 payload 参考 agent.json。
     */
    minimalParams?: boolean
    /** 智能体配置（提取 rerank_config / web_search_setting / completion_params） */
    agentInfo?: any
    /** workbench 单选技能 */
    skill?: { display_name?: string; skill_name?: string }
    /** knowledge 模型 id，格式：channel_id_channel_type_model，拼到 model 后缀 */
    modelId?: string
    /** 知识源配置（直通模式） */
    knowledgeSource?: KnowledgeSourceConfig
    /** 知识库 ID 列表 */
    library?: { value: string[] | number[] }
    /** @文件选择（知识库/空间） */
    links?: any[]
    /**
     * 上传的文件列表
     * - work-ai: 用 upload_file_id 加入 user 消息（不带 specified_files info）
     * - 其他场景: 转为 file_id 格式
     */
    files?: Array<{
      id: string | number
      name: string
      size: number
      mime_type: string
      preview_key?: string
      upload_file_id?: string
    }>
    /** 消息增强选项 */
    options?: { prompt?: string; text?: string }

    signal?: AbortSignal
    onDownloadProgress?: (data: any) => void
  }) => Promise<void>

  /** 运行工作流 */
  runWorkflow?: (data: {
    conversation_id: string | number
    model: string
    parameters: Record<string, any>
    stream: boolean
  }, options?: { responseType?: string; signal?: AbortSignal }) => Promise<any>

  /** 上传文件 */
  uploadFile?: (file: File) => Promise<{
    id: string | number
    url: string
    size: number
    name: string
    mime_type: string
  }>

  /** 消息气泡组件库（hub-ui-x-react） */
  BubbleComponents?: {
    XBubbleList: ComponentType<any>
    XBubbleUser: ComponentType<any>
    XBubbleAssistant: ComponentType<any>
    XIcon: ComponentType<any>
    XSender: ComponentType<any>
  }

  /** 其他组件 */
  OtherComponents?: {
    PromptInput?: ComponentType<any>
    DatePicker?: ComponentType<any>
    MarkdownEditor?: ComponentType<any>
    SelectPlus?: ComponentType<any>
    ModelSelectPopover?: ComponentType<{
      className?: string
      value?: string
      channelId?: number
      modelName?: string
      temperature?: number
      type?: any
      mode?: any
      customClass?: string
      onChange?: (value: string) => void
      onTemperatureChange?: (value: number) => void
    }>
  }

  /** 加载平台设置（博查等） */
  loadPlatformSettings?: () => Promise<any[]>

  /** 重置 Openclaw 密钥 */
  resetSecret?: (agentId: string | number) => Promise<{ secret: string }>
}

// ==================== 适配器上下文 ====================

/** 适配器上下文值 */
export interface AdapterContextValue {
  adapter: IAgentCreateAdapter
  /** 当前支持的平台列表（已根据配置过滤） */
  supportedPlatforms: AgentType[]
}
