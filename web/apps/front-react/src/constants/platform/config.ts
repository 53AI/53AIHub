import { img_host } from '@/utils/config'

// 智能体类型定义
const AGENT_TYPE = {
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
}

const AGENT_MODES = {
  CHAT: 'chat',
  COMPLETION: 'completion',
  ASSISTANT: 'assistant',
} as const

// 统一的平台配置
const PLATFORM_CONFIG = {
  prompt: {
    providerValue: 0,
    channelValue: 0,
    category: 'model_platform',
    auth: false,
    label: window.$t?.('provider_platform.prompt') || 'Prompt',
    agents: [
      {
        id: AGENT_TYPE.PROMPT,
        name: AGENT_TYPE.PROMPT,
        label: window.$t?.('agent_app.prompt') || 'Prompt',
      },
    ],
  },
  coze_cn: {
    providerValue: 1,
    channelValue: 34,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t?.('provider_platform.coze_cn') || 'Coze (CN)',
    agents: [
      {
        id: AGENT_TYPE.COZE_AGENT_CN,
        name: AGENT_TYPE.COZE_AGENT_CN,
        label: window.$t?.('agent_app.coze_agent_cn') || 'Coze Agent (CN)',
      },
      {
        id: AGENT_TYPE.COZE_WORKFLOW_CN,
        name: AGENT_TYPE.COZE_WORKFLOW_CN,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.coze_workflow_cn') || 'Coze Workflow (CN)',
        visible: false,
      },
    ],
  },
  coze_osv: {
    providerValue: 5,
    channelValue: 1010,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t?.('provider_platform.coze_osv') || 'Coze (OSV)',
    agents: [
      {
        id: AGENT_TYPE.COZE_AGENT_OSV,
        name: AGENT_TYPE.COZE_AGENT_OSV,
        label: window.$t?.('agent_app.coze_agent_osv') || 'Coze Agent (OSV)',
      },
      {
        id: AGENT_TYPE.COZE_WORKFLOW_OSV,
        name: AGENT_TYPE.COZE_WORKFLOW_OSV,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.coze_workflow_osv') || 'Coze Workflow (OSV)',
        visible: false,
      },
    ],
  },
  app_builder: {
    providerValue: 3,
    channelValue: 1005,
    category: 'cloud_computing_platform',
    auth: true,
    label: window.$t?.('provider_platform.app_builder') || 'App Builder',
    agents: [
      {
        id: AGENT_TYPE.APP_BUILDER,
        name: AGENT_TYPE.APP_BUILDER,
        label: window.$t?.('agent_app.app_builder') || 'App Builder',
      },
    ],
  },
  '53ai': {
    providerValue: 4,
    channelValue: 1002,
    category: 'intelligent_agent_platform',
    auth: true,
    label: window.$t?.('provider_platform.53ai') || '53AI',
    agents: [
      {
        id: AGENT_TYPE['53AI_AGENT'],
        name: AGENT_TYPE['53AI_AGENT'],
        label: window.$t?.('agent_app.53ai_agent') || '53AI Agent',
      },
      {
        id: AGENT_TYPE['53AI_WORKFLOW'],
        name: AGENT_TYPE['53AI_WORKFLOW'],
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.53ai_workflow') || '53AI Workflow',
        visible: false,
      },
    ],
  },
  dify: {
    channelValue: 1001,
    providerValue: 1001,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t?.('provider_platform.dify') || 'Dify',
    agents: [
      {
        id: AGENT_TYPE.DIFY_AGENT,
        name: AGENT_TYPE.DIFY_AGENT,
        label: window.$t?.('agent_app.dify_agent') || 'Dify Agent',
      },
      {
        id: AGENT_TYPE.DIFY_WORKFLOW,
        name: AGENT_TYPE.DIFY_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.dify_workflow') || 'Dify Workflow',
        visible: false,
      },
    ],
  },
  bailian: {
    channelValue: 1003,
    providerValue: 1003,
    category: 'cloud_computing_platform',
    auth: false,
    label: window.$t?.('provider_platform.bailian') || 'Bailian',
    agents: [
      {
        id: AGENT_TYPE.BAILIAN,
        name: AGENT_TYPE.BAILIAN,
        label: window.$t?.('agent_app.bailian') || 'Bailian',
      },
    ],
  },
  volcengine: {
    channelValue: 1004,
    providerValue: 1004,
    category: 'cloud_computing_platform',
    auth: false,
    label: window.$t?.('provider_platform.volcengine') || 'Volcengine',
    agents: [
      {
        id: AGENT_TYPE.VOLCENGINE,
        name: AGENT_TYPE.VOLCENGINE,
        label: window.$t?.('agent_app.volcengine') || 'Volcengine',
      },
    ],
  },
  yuanqi: {
    channelValue: 1006,
    providerValue: 1006,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t?.('provider_platform.yuanqi') || 'Yuanqi',
    agents: [
      {
        id: AGENT_TYPE.YUANQI,
        name: AGENT_TYPE.YUANQI,
        label: window.$t?.('agent_app.yuanqi') || 'Yuanqi',
      },
    ],
  },
  fastgpt: {
    channelValue: 22,
    providerValue: 22,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t?.('provider_platform.fastgpt') || 'FastGPT',
    agents: [
      {
        id: AGENT_TYPE.FASTGPT_AGENT,
        name: AGENT_TYPE.FASTGPT_AGENT,
        label: window.$t?.('agent_app.fastgpt_agent') || 'FastGPT Agent',
      },
      {
        id: AGENT_TYPE.FASTGPT_WORKFLOW,
        name: AGENT_TYPE.FASTGPT_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.fastgpt_workflow') || 'FastGPT Workflow',
        visible: false,
      },
    ],
  },
  maxkb: {
    channelValue: 1008,
    providerValue: 1008,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t?.('provider_platform.maxkb') || 'MaxKB',
    agents: [
      {
        id: AGENT_TYPE.MAXKB_AGENT,
        name: AGENT_TYPE.MAXKB_AGENT,
        label: window.$t?.('agent_app.maxkb_agent') || 'MaxKB Agent',
      },
    ],
  },
  n8n: {
    providerValue: 1009,
    channelValue: 1009,
    category: 'intelligent_agent_platform',
    auth: false,
    label: window.$t?.('provider_platform.n8n') || 'N8N',
    agents: [
      {
        id: AGENT_TYPE.N8N_WORKFLOW,
        name: AGENT_TYPE.N8N_WORKFLOW,
        mode: AGENT_MODES.COMPLETION,
        label: window.$t?.('agent_app.n8n_workflow') || 'N8N Workflow',
      },
    ],
  },
  tencent: {
    providerValue: 6,
    channelValue: 1011,
    category: 'cloud_computing_platform',
    auth: true,
    label: window.$t?.('provider_platform.tencent') || 'Tencent',
    agents: [
      {
        id: AGENT_TYPE.TENCENT,
        name: AGENT_TYPE.TENCENT,
        mode: AGENT_MODES.CHAT,
        label: window.$t?.('agent_app.tencent') || 'Tencent',
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

export { AGENT_MODES, BACKEND_AGENT_TYPE }

export const AGENT_CATEGORIES = {
  INTELLIGENT_AGENT_PLATFORM: 'intelligent_agent_platform',
  CLOUD_COMPUTING_PLATFORM: 'cloud_computing_platform',
  MODEL_PLATFORM: 'model_platform',
} as const

// 类型定义
export type AgentType = (typeof AGENT_TYPE)[keyof typeof AGENT_TYPE]
export type ChannelType = keyof typeof PLATFORM_CONFIG
export type ChannelValue = (typeof PLATFORM_CONFIG)[keyof typeof PLATFORM_CONFIG]['channelValue']
export type AgentMode = (typeof AGENT_MODES)[keyof typeof AGENT_MODES]
export type AgentCategory = (typeof AGENT_CATEGORIES)[keyof typeof AGENT_CATEGORIES]

// 导出常量
export const AGENT_TYPES = AGENT_TYPE

export const CHANNEL_TYPE_VALUE_MAP = new Map([
  ...Object.entries(PLATFORM_CONFIG).map(([key, value]) => [key, value.channelValue] as const),
  ...Object.values(PLATFORM_CONFIG).flatMap(config =>
    config.agents.map(agent => [agent.name, ('channelValue' in agent ? agent.channelValue : config.channelValue)] as const)
  ),
])

// 配置接口
interface AgentConfig {
  id: AgentType
  name: AgentType
  label: string
  icon: string
  channelName: ChannelType
  channelType: ChannelValue
  providerId: number
  mode: AgentMode
  category: AgentCategory
  visible: boolean
}

// 生成 agents 配置
export const agents: Record<AgentType, AgentConfig> = Object.fromEntries(
  Object.entries(PLATFORM_CONFIG)
    .map(([key, config]) => {
      return config.agents.map(agent => {
        return [
          agent.name,
          {
            id: agent.name as AgentType,
            name: agent.name as AgentType,
            label: agent.label,
            icon: `${img_host}/agent/${agent.name.toLowerCase()}.png`,
            channelName: key as ChannelType,
            channelType: ('channelValue' in agent ? agent.channelValue : config.channelValue) as ChannelValue,
            providerId: config.providerValue,
            mode: agent.mode || AGENT_MODES.CHAT,
            category: config.category as AgentCategory,
            visible: 'visible' in agent ? agent.visible : true,
          },
        ]
      })
    })
    .flat()
) as Record<AgentType, AgentConfig>

// 工具函数
export const getAgentByAgentType = (agentType: AgentType): AgentConfig =>
  agents[agentType] || ({} as AgentConfig)
