import { img_host } from '@/utils/config'

// 智能体类型定义
const AGENT_TYPE = {
  WORKBENCH: 'workbench',
  KNOWLEDGE: 'knowledge',
  PROMPT: 'prompt',
  COZE_AGENT_CN: 'coze_agent_cn',
  COZE_WORKFLOW_CN: 'coze_workflow_cn',
  COZE_AGENT_OSV: 'coze_agent_osv',
  COZE_WORKFLOW_OSV: 'coze_workflow_osv',
  APP_BUILDER: 'app_builder',
  '53AI_AGENT': '53ai_agent',
  '53AI_WORKFLOW': '53ai_workflow',
  DIFY_AGENT: 'dify_agent',
  DIFY_WORKFLOW: 'dify_workflow',
  BAILIAN: 'bailian',
  VOLCENGINE: 'volcengine',
  YUANQI: 'yuanqi',
  FASTGPT_AGENT: 'fastgpt_agent',
  FASTGPT_WORKFLOW: 'fastgpt_workflow',
  MAXKB_AGENT: 'maxkb_agent',
  N8N_WORKFLOW: 'n8n_workflow',
  TENCENT: 'tencent',
  OPENCLAW: 'openclaw',
  QCLAW: 'qclaw',
  CODEX: 'codex',
  MANUS: 'manus',
} as const

const BACKEND_AGENT_TYPE = {
  AGENT: 0,
  WORKFLOW: 1,
  ASSISTANT: 2,
}

const AGENT_MODES = {
  CHAT: 'chat',
  COMPLETION: 'completion',
  ASSISTANT: 'assistant',
} as const

const MODEL_USE_TYPE = {
  // 推理
  REASONING: '1',
  // 嵌入
  EMBEDDING: '2',
  // 重排序
  RERANKER: '3',
} as const

const REASONING_MODE = {
  FAST: 'fast',
  DEEP: 'deep',
} as const

// 统一的平台配置
const PLATFORM_CONFIG = {
  prompt: {
    // 提供商ID
    providerValue: 0,
    // 渠道ID
    channelValue: 0,
    // 分类
    category: 'model_platform',
    // 需不需要授权
    auth: false,
    // 智能体列表
    label: window.$t('provider_platform.prompt'),
    agents: [
      {
        id: AGENT_TYPE.PROMPT,
        name: AGENT_TYPE.PROMPT,
        label: window.$t('agent_app.prompt'),
      },
    ],
  },
  coze_cn: {
    providerValue: 1,
    channelValue: 34,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t('provider_platform.coze_cn'),
    agents: [
      {
        id: AGENT_TYPE.COZE_AGENT_CN,
        name: AGENT_TYPE.COZE_AGENT_CN,
        label: window.$t('agent_app.coze_agent_cn'),
      },
      {
        id: AGENT_TYPE.COZE_WORKFLOW_CN,
        name: AGENT_TYPE.COZE_WORKFLOW_CN,
        mode: AGENT_MODES.COMPLETION,
        visible: false,
      },
    ],
  },
  coze_osv: {
    providerValue: 5,
    channelValue: 1010,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t('provider_platform.coze_osv'),
    agents: [
      {
        id: AGENT_TYPE.COZE_AGENT_OSV,
        name: AGENT_TYPE.COZE_AGENT_OSV,
        label: window.$t('agent_app.coze_agent_osv'),
      },
      {
        id: AGENT_TYPE.COZE_WORKFLOW_OSV,
        name: AGENT_TYPE.COZE_WORKFLOW_OSV,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t('agent_app.coze_workflow_osv'),
        visible: false,
      },
    ],
  },
  app_builder: {
    providerValue: 3,
    channelValue: 1005,
    category: 'cloud_computing_platform',
    auth: true,
    label: window.$t('provider_platform.app_builder'),
    agents: [
      {
        id: AGENT_TYPE.APP_BUILDER,
        name: AGENT_TYPE.APP_BUILDER,
        label: window.$t('agent_app.app_builder'),
      },
    ],
  },
  '53ai': {
    providerValue: 4,
    channelValue: 1002,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t('provider_platform.53ai'),
    agents: [
      {
        id: AGENT_TYPE['53AI_AGENT'],
        name: AGENT_TYPE['53AI_AGENT'],
        label: window.$t('agent_app.53ai_agent'),
      },
      {
        id: AGENT_TYPE['53AI_WORKFLOW'],
        name: AGENT_TYPE['53AI_WORKFLOW'],
        mode: AGENT_MODES.COMPLETION,
        label: window.$t('agent_app.53ai_workflow'),
        visible: false,
      },
    ],
  },
  dify: {
    channelValue: 1001,
    providerValue: 1001,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t('provider_platform.dify'),
    agents: [
      {
        id: AGENT_TYPE.DIFY_AGENT,
        name: AGENT_TYPE.DIFY_AGENT,
        label: window.$t('agent_app.dify_agent'),
      },
      {
        id: AGENT_TYPE.DIFY_WORKFLOW,
        name: AGENT_TYPE.DIFY_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t('agent_app.dify_workflow'),
        visible: false,
      },
    ],
  },
  bailian: {
    channelValue: 1003,
    providerValue: 1003,
    category: 'cloud_computing_platform',
    auth: false,
    label: window.$t('provider_platform.bailian'),
    agents: [
      {
        id: AGENT_TYPE.BAILIAN,
        name: AGENT_TYPE.BAILIAN,
        label: window.$t('agent_app.bailian'),
      },
    ],
  },
  volcengine: {
    channelValue: 1004,
    providerValue: 1004,
    category: 'cloud_computing_platform',
    auth: false,
    label: window.$t('provider_platform.volcengine'),
    agents: [
      {
        id: AGENT_TYPE.VOLCENGINE,
        name: AGENT_TYPE.VOLCENGINE,
        label: window.$t('agent_app.volcengine'),
      },
    ],
  },
  yuanqi: {
    channelValue: 1006,
    providerValue: 1006,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t('provider_platform.yuanqi'),
    agents: [
      {
        id: AGENT_TYPE.YUANQI,
        name: AGENT_TYPE.YUANQI,
        label: window.$t('agent_app.yuanqi'),
      },
    ],
  },
  fastgpt: {
    channelValue: 22,
    providerValue: 22,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t('provider_platform.fastgpt'),
    agents: [
      {
        id: AGENT_TYPE.FASTGPT_AGENT,
        name: AGENT_TYPE.FASTGPT_AGENT,
        label: window.$t('agent_app.fastgpt_agent'),
      },
      {
        id: AGENT_TYPE.FASTGPT_WORKFLOW,
        name: AGENT_TYPE.FASTGPT_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t('agent_app.fastgpt_workflow'),
        visible: false,
      },
    ],
  },
  maxkb: {
    channelValue: 1008,
    providerValue: 1008,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t('provider_platform.maxkb'),
    agents: [
      {
        id: AGENT_TYPE.MAXKB_AGENT,
        name: AGENT_TYPE.MAXKB_AGENT,
        label: window.$t('agent_app.maxkb_agent'),
      },
    ],
  },
  n8n: {
    providerValue: 1009,
    channelValue: 1009,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t('provider_platform.n8n'),
    agents: [
      {
        id: AGENT_TYPE.N8N_WORKFLOW,
        name: AGENT_TYPE.N8N_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t('agent_app.n8n_workflow'),
      },
    ],
  },
  tencent: {
    providerValue: 6,
    channelValue: 1011,
    category: 'cloud_computing_platform',
    auth: true,
    label: window.$t('provider_platform.tencent'),
    agents: [
      {
        id: AGENT_TYPE.TENCENT,
        name: AGENT_TYPE.TENCENT,
        mode: AGENT_MODES.CHAT,
        label: window.$t('agent_app.tencent'),
      },
    ],
  },
  openclaw: {
    providerValue: 1014,
    channelValue: 1014,
    category: 'model_platform',
    auth: false,
    label: 'OpenClaw',
    agents: [
      {
        id: AGENT_TYPE.OPENCLAW,
        name: AGENT_TYPE.OPENCLAW,
        channelValue: 1014,
        mode: AGENT_MODES.ASSISTANT,
        label: 'OpenClaw',
      },
      {
        id: AGENT_TYPE.QCLAW,
        name: AGENT_TYPE.QCLAW,
        channelValue: 1015,
        mode: AGENT_MODES.ASSISTANT,
        label: 'QClaw',
      },
      {
        id: AGENT_TYPE.CODEX,
        name: AGENT_TYPE.CODEX,
        channelValue: 1016,
        mode: AGENT_MODES.ASSISTANT,
        label: 'Codex',
      },
      {
        id: AGENT_TYPE.MANUS,
        name: AGENT_TYPE.MANUS,
        channelValue: 1017,
        mode: AGENT_MODES.ASSISTANT,
        label: 'Manus',
      },
    ],
  },
} as const

// 统一的大模型配置
const MODEL_CONFIG = {
  siliconflow: {
    name: 'siliconflow',
    owner: 'siliconflow',
    channelType: 44,
    multiple: false,
    label: window.$t('provider_platform.siliconflow'),
  },
  deepseek: {
    name: 'deepseek',
    owner: 'deepseek',
    channelType: 36,
    multiple: false,
    label: window.$t('provider_platform.deepseek'),
  },
  openai: {
    name: 'openai',
    owner: 'openai',
    channelType: 1,
    multiple: false,
    label: window.$t('provider_platform.openai'),
  },
  azure: {
    name: 'azure',
    owner: 'openai',
    channelType: 3,
    multiple: true,
    label: window.$t('provider_platform.azure'),
  },
  bailian: {
    name: 'bailian',
    owner: 'bailian',
    channelType: 17,
    multiple: false,
    label: window.$t('provider_platform.bailian'),
  },
  volcengine: {
    name: 'volcengine',
    owner: 'volcengine',
    channelType: 900,
    multiple: false,
    label: window.$t('provider_platform.volcengine'),
  },
  qianfan: {
    name: 'qianfan',
    owner: 'qianfan',
    channelType: 901,
    multiple: false,
    label: window.$t('provider_platform.app_builder'),
  },
  moonshot: {
    name: 'moonshot',
    owner: 'moonshot',
    channelType: 25,
    multiple: false,
    label: window.$t('provider_platform.dark_moon'),
  },
  gemini: {
    name: 'gemini',
    owner: 'gemini',
    channelType: 24,
    multiple: false,
    label: window.$t('provider_platform.gemini'),
  },
  custom_openai: {
    name: 'custom_openai',
    owner: 'custom_openai',
    channelType: 1012,
    multiple: true,
    label: window.$t('provider_platform.custom_openai'),
  },
} as const

export { AGENT_MODES, BACKEND_AGENT_TYPE, MODEL_USE_TYPE, REASONING_MODE }

export const AGENT_CATEGORIES = {
  INTELLIGENT_AGENT_PLATFORM: 'intelligent_agent_platform',
  CLOUD_COMPUTING_PLATFORM: 'cloud_computing_platform',
  MODEL_PLATFORM: 'model_platform',
} as const

export const PROVIDER_CATEGORIES = {
  INTELLIGENT_AGENT_PLATFORM: 'intelligent_agent_platform',
  CLOUD_COMPUTING_PLATFORM: 'cloud_computing_platform',
} as const

// 类型定义
export type ProviderId = number
export type AgentType = (typeof AGENT_TYPE)[keyof typeof AGENT_TYPE]
export type ChannelType = keyof typeof PLATFORM_CONFIG
export type ChannelValue = (typeof PLATFORM_CONFIG)[keyof typeof PLATFORM_CONFIG]['channelValue']

export type ProviderType = keyof typeof PLATFORM_CONFIG
export type ProviderValue = (typeof PLATFORM_CONFIG)[keyof typeof PLATFORM_CONFIG]['providerValue']

export type ModelType = keyof typeof MODEL_CONFIG
export type ModelValue = (typeof MODEL_CONFIG)[keyof typeof MODEL_CONFIG]['channelType']
export type ModelUseType = (typeof MODEL_USE_TYPE)[keyof typeof MODEL_USE_TYPE]
export type ReasoningMode = (typeof REASONING_MODE)[keyof typeof REASONING_MODE]

export type AgentMode = (typeof AGENT_MODES)[keyof typeof AGENT_MODES]
export type AgentCategory = (typeof AGENT_CATEGORIES)[keyof typeof AGENT_CATEGORIES]
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[keyof typeof PROVIDER_CATEGORIES]

// 从配置对象中提取键
type ConfigKeys = keyof typeof PLATFORM_CONFIG
type ModelKeys = keyof typeof MODEL_CONFIG

// 创建值类型映射
export type ProviderValuesType = Record<Uppercase<ConfigKeys & string>, number>
export type ChannelValuesType = Record<Uppercase<ConfigKeys & string>, number>
export type AgentValuesType = Record<Uppercase<ConfigKeys & string>, string>
export type ModelValuesType = Record<Uppercase<ModelKeys & string>, number>

// 导出常量
export const AGENT_TYPES = AGENT_TYPE

export const CHANNEL_TYPES = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key]) => [key.toUpperCase(), key])
) as Record<Uppercase<ConfigKeys & string>, string>
export const PROVIDER_TYPES = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key]) => [key.toUpperCase(), key])
) as Record<Uppercase<ConfigKeys & string>, string>
export const MODEL_TYPES = Object.fromEntries(
  Object.entries(MODEL_CONFIG).map(([key]) => [key.toUpperCase(), key])
) as Record<Uppercase<ModelKeys & string>, string>

// 创建常量并指定类型
export const PROVIDER_VALUES = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key, config]) => [key.toUpperCase(), config.providerValue])
) as ProviderValuesType

export const CHANNEL_VALUES = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key, config]) => [key.toUpperCase(), config.channelValue])
) as ChannelValuesType

export const AGENT_VALUES = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key, config]) => [key.toUpperCase(), config.agents[0].name])
) as AgentValuesType

export const MODEL_VALUES = Object.fromEntries(
  Object.entries(MODEL_CONFIG).map(([key, config]) => [key.toUpperCase(), config.channelType])
) as ModelValuesType

// 配置接口
export interface ProviderConfig {
  id: ProviderId
  name: string
  icon: string
  label: string
  channelId: ChannelType
  agentId: AgentType
  auth: boolean
  category: ProviderCategory
}

interface ChannelConfig {
  id: ChannelType
  name: string
  label: string
  icon: string
  channelType: number
}

interface AgentConfig {
  id: AgentType
  name: AgentType
  label: string
  icon: string
  channelName: ChannelType
  channelType: ChannelValue
  providerId: ProviderValue
  mode: AgentMode
  category: AgentCategory
  visible: boolean
}

export interface ModelConfig {
  id: ModelType
  name: string
  label: string
  icon: string
  owner: string
  channelType: ModelValue
  multiple: boolean
}

// 通用配置生成函数
const createConfig = <T>(type: string, template: (type: string) => T): T => template(type)

// 配置数据生成
export const providers: Record<ProviderId, ProviderConfig> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG)
    .filter(([, config]) => config.providerValue > 0 && config.providerValue !== 1014)
    .map(([key, config]) => [
      config.providerValue,
      createConfig(key, type => ({
        id: config.providerValue,
        name: type,
        icon: type,
        label: config.label,
        provider_type: config.providerValue,
        channelId: type as ChannelType,
        agentId: config.agents[0].name as AgentType,
        auth: config.auth,
        category: config.category as ProviderCategory,
      })),
    ])
) as Record<ProviderId, ProviderConfig>

export const channels: Record<ChannelType, ChannelConfig> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG).map(([key, config]) => [
    key,
    createConfig(key, type => ({
      id: type as ChannelType,
      name: type,
      label: config.label,
      icon: type,
      channelType: config.channelValue,
    })),
  ])
) as Record<ChannelType, ChannelConfig>

export const agents: Record<AgentType, AgentConfig> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG)
    .map(([key, config]) => {
      return config.agents.map(agent => {
        return [
          agent.name,
          createConfig(agent.name, type => ({
            id: type as AgentType,
            name: type as AgentType,
            label: agent.label,
            icon: `${img_host}/agent/${type.toLowerCase()}.png`,
            channelName: key as ChannelType,
            channelType: ('channelValue' in agent ? agent.channelValue : config.channelValue) as ChannelValue,
            providerId: config.providerValue as ProviderValue,
            mode: agent.mode || AGENT_MODES.CHAT,
            category: config.category as AgentCategory,
            visible: 'visible' in agent ? agent.visible : true,
          })),
        ]
      })
    })
    .flat()
) as Record<AgentType, AgentConfig>
// 模型配置
export const models = Object.fromEntries(
  Object.entries(MODEL_CONFIG).map(([key, config]) => [
    key,
    createConfig(key, type => ({
      id: type as ModelType,
      name: type,
      label: config.label,
      icon: type,
      owner: config.owner,
      channelType: config.channelType,
      multiple: config.multiple,
    })),
  ])
) as Record<ModelType, ModelConfig>

// 渠道类型映射
const CHANNEL_MAPPINGS = [
  ['openai', 1],
  ['API2D', 2],
  ['Azure', 3],
  ['azure', 3],
  ['CloseAI', 4],
  ['OpenAISB', 5],
  ['OpenAIMax', 6],
  ['OhMyGPT', 7],
  ['Custom', 8],
  ['Ails', 9],
  ['AIProxy', 10],
  ['PaLM', 11],
  ['API2GPT', 12],
  ['AIGC2D', 13],
  ['Anthropic', 14],
  ['Baidu', 15],
  ['Zhipu', 16],
  ['zhipu', 16],
  ['Ali', 17],
  ['Xunfei', 18],
  ['AI360', 19],
  ['OpenRouter', 20],
  ['AIProxyLibrary', 21],
  ['FastGPT', 22],
  ['Tencent', 23],
  ['Gemini', 24],
  ['Moonshot', 25],
  ['dark_moon', 25],
  ['Baichuan', 26],
  ['Minimax', 27],
  ['Mistral', 28],
  ['Groq', 29],
  ['Ollama', 30],
  ['LingYiWanWu', 31],
  ['StepFun', 32],
  ['AwsClaude', 33],
  ['coze', 34],
  ['Cohere', 35],
  ['deepseek', 36],
  ['deep_seek', 36],
  ['Cloudflare', 37],
  ['DeepL', 38],
  ['TogetherAI', 39],
  ['Doubao', 40],
  ['Novita', 41],
  ['VertextAI', 42],
  ['Proxy', 43],
  ['siliconflow', 44],
  ['silicon_flow', 44],
  ['XAI', 45],
  ['Replicate', 46],
  ['Dummy', 47],
  // ['dify', 1001],
  // ['53ai', 1002],
  // ['n8n', 1009],
] as const

export const CHANNEL_TYPE_VALUE_MAP = new Map([
  ...CHANNEL_MAPPINGS,
  ...Object.entries(PLATFORM_CONFIG).map(([key, value]) => [key, value.channelValue] as const),
  ...Object.entries(models).map(([key, value]) => [key, value.channelType] as const),
  ...Object.entries(agents).map(([key, value]) => [key, value.channelType] as const),
])
// 工具函数
export const getProviderByProviderType = (providerType: ProviderType): ProviderConfig =>
  providers[providerType] || ({} as ProviderConfig)

export const getProviderByAgentId = (agentId: AgentType) =>
  agents[agentId]?.providerId && providers[agents[agentId].providerId]

export const getAgentsByCategory = (category: AgentConfig['category']) =>
  Object.values(agents).filter(agent => agent.category === category)

export const getAgentsByProvider = (providerId: ProviderId) =>
  Object.values(agents).filter(agent => agent.providerId === providerId)

export const getAgentByAgentType = (agentType: AgentType): AgentConfig =>
  agents[agentType] || ({} as AgentConfig)

export const getAgentByChannelType = (channelType: ChannelValue): AgentConfig => {
  return (
    Object.values(agents).find(agent => agent.channelType === channelType) || ({} as AgentConfig)
  )
}

export const getProvidersByAuth = (auth: boolean): ProviderConfig[] =>
  Object.values(providers).filter(provider => provider.auth === auth)

// 获取所有 models 中的channleType
export const getModelChannelTypes = () => {
  return Object.values(models).map(model => model.channelType)
}

export const getModelByChannelType = (channelType: ModelValue): ModelConfig =>
  Object.values(models).find(model => model.channelType === channelType) || ({} as ModelConfig)
