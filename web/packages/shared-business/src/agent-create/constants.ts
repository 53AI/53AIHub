/** Agent 平台类型常量 */
export const AGENT_TYPES = {
  PROMPT: 'prompt',
  WORKBENCH: 'workbench',
  KNOWLEDGE: 'knowledge',
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

export type AgentPlatformType = (typeof AGENT_TYPES)[keyof typeof AGENT_TYPES]

export const OPENCLAW_COMPATIBLE_AGENT_TYPES = [
  AGENT_TYPES.OPENCLAW,
  AGENT_TYPES.QCLAW,
  AGENT_TYPES.CODEX,
  AGENT_TYPES.MANUS,
] as const

export type OpenClawCompatibleAgentType = (typeof OPENCLAW_COMPATIBLE_AGENT_TYPES)[number]

export const OPENCLAW_COMPATIBLE_CREATABLE_AGENT_TYPES = [
  AGENT_TYPES.OPENCLAW,
  AGENT_TYPES.QCLAW,
] as const

export const OPENCLAW_WS_CHANNEL_TYPE = 1014
export const QCLAW_WS_CHANNEL_TYPE = 1015
export const CODEX_WS_CHANNEL_TYPE = 1016
export const MANUS_WS_CHANNEL_TYPE = 1017
export const OPENCLAW_WS_MODEL = 'openclaw-ws'

export const OPENCLAW_COMPATIBLE_CHANNEL_TYPES: Record<OpenClawCompatibleAgentType, number> = {
  [AGENT_TYPES.OPENCLAW]: OPENCLAW_WS_CHANNEL_TYPE,
  [AGENT_TYPES.QCLAW]: QCLAW_WS_CHANNEL_TYPE,
  [AGENT_TYPES.CODEX]: CODEX_WS_CHANNEL_TYPE,
  [AGENT_TYPES.MANUS]: MANUS_WS_CHANNEL_TYPE,
}

export interface OpenClawCompatibleAgentMetadata {
  agentType: OpenClawCompatibleAgentType
  label: string
  hostKind: OpenClawCompatibleAgentType
  channelType: number
  iconFileName: string
  runnerCommand?: string
}

export const OPENCLAW_COMPATIBLE_AGENT_METADATA: Record<OpenClawCompatibleAgentType, OpenClawCompatibleAgentMetadata> = {
  [AGENT_TYPES.OPENCLAW]: {
    agentType: AGENT_TYPES.OPENCLAW,
    label: 'OpenClaw',
    hostKind: AGENT_TYPES.OPENCLAW,
    channelType: OPENCLAW_WS_CHANNEL_TYPE,
    iconFileName: 'openclaw.png',
  },
  [AGENT_TYPES.QCLAW]: {
    agentType: AGENT_TYPES.QCLAW,
    label: 'QClaw',
    hostKind: AGENT_TYPES.QCLAW,
    channelType: QCLAW_WS_CHANNEL_TYPE,
    iconFileName: 'qclaw.png',
  },
  [AGENT_TYPES.CODEX]: {
    agentType: AGENT_TYPES.CODEX,
    label: 'Codex',
    hostKind: AGENT_TYPES.CODEX,
    channelType: CODEX_WS_CHANNEL_TYPE,
    iconFileName: 'codex.png',
    runnerCommand: 'codex-app-server',
  },
  [AGENT_TYPES.MANUS]: {
    agentType: AGENT_TYPES.MANUS,
    label: 'Manus',
    hostKind: AGENT_TYPES.MANUS,
    channelType: MANUS_WS_CHANNEL_TYPE,
    iconFileName: 'manus.png',
  },
}

export function isOpenClawCompatibleAgentType(agentType?: unknown): agentType is OpenClawCompatibleAgentType {
  return OPENCLAW_COMPATIBLE_AGENT_TYPES.includes(agentType as OpenClawCompatibleAgentType)
}

function normalizeOpenClawCompatibleAgentType(agentType?: unknown): OpenClawCompatibleAgentType | undefined {
  const normalized = String(agentType || '').trim().toLowerCase()
  if (isOpenClawCompatibleAgentType(normalized)) {
    return normalized
  }
  return undefined
}

export function getOpenClawCompatibleAgentMetadata(agentType?: unknown): OpenClawCompatibleAgentMetadata {
  const normalized = normalizeOpenClawCompatibleAgentType(agentType)
  if (isOpenClawCompatibleAgentType(normalized)) {
    return OPENCLAW_COMPATIBLE_AGENT_METADATA[normalized]
  }
  return OPENCLAW_COMPATIBLE_AGENT_METADATA[AGENT_TYPES.OPENCLAW]
}

export function getOpenClawCompatibleChannelType(agentType?: unknown): number {
  return getOpenClawCompatibleAgentMetadata(agentType).channelType
}

export function isOpenClawCompatibleChannelType(channelType?: unknown): boolean {
  const normalizedChannelType = Number(channelType)
  return Object.values(OPENCLAW_COMPATIBLE_CHANNEL_TYPES).includes(normalizedChannelType)
}

export function resolveOpenClawCompatibleAgentTypeFromChannelType(
  channelType?: unknown,
): OpenClawCompatibleAgentType | undefined {
  const normalizedChannelType = Number(channelType)
  const entry = Object.entries(OPENCLAW_COMPATIBLE_CHANNEL_TYPES)
    .find(([, value]) => value === normalizedChannelType)
  return entry?.[0] as OpenClawCompatibleAgentType | undefined
}

export function getOpenClawCompatibleAgentIconPath(
  agentType?: unknown,
  getPublicPath?: (path: string) => string,
): string {
  const metadata = getOpenClawCompatibleAgentMetadata(agentType)
  const relativePath = `/images/agent/${metadata.iconFileName}`
  return getPublicPath ? getPublicPath(relativePath) : relativePath
}

export function resolveOpenClawCompatibleAgentLogo(logo?: unknown, agentType?: unknown): string {
  const metadata = getOpenClawCompatibleAgentMetadata(agentType)
  const bundledLogo = getOpenClawCompatibleAgentIconPath(metadata.agentType)
  const rawLogo = typeof logo === 'string' ? logo.trim() : ''
  if (!rawLogo) return bundledLogo

  const builtInAgentIconPattern = /\/api\/images\/agent\/(openclaw|qclaw|codex|manus)\.png(?:[?#].*)?$/i
  if (builtInAgentIconPattern.test(rawLogo)) {
    return bundledLogo
  }

  return rawLogo
}

export interface OpenClawCompatibleAgentRecord {
  channel_type?: unknown
  model?: unknown
  custom_config?: Record<string, any> | null
}

export function resolveOpenClawCompatibleAgentTypeFromRecord(
  record?: OpenClawCompatibleAgentRecord | null,
): OpenClawCompatibleAgentType | undefined {
  if (!record) return undefined

  const customConfig = record.custom_config || {}
  const explicitAgentType = normalizeOpenClawCompatibleAgentType(customConfig.agent_type)
  if (explicitAgentType) return explicitAgentType

  const hostKind = normalizeOpenClawCompatibleAgentType(customConfig.hostKind)
    || normalizeOpenClawCompatibleAgentType(customConfig.host_kind)
  if (hostKind) return hostKind

  const channelType = Number(record.channel_type)
  const model = typeof record.model === 'string' ? record.model.trim().toLowerCase() : ''
  const channelAgentType = resolveOpenClawCompatibleAgentTypeFromChannelType(channelType)
  if (channelAgentType) {
    return channelAgentType
  }

  if (model === OPENCLAW_WS_MODEL) {
    return AGENT_TYPES.OPENCLAW
  }

  return undefined
}

export function normalizeOpenClawCompatibleCustomConfig(
  customConfig: Record<string, any> | null | undefined,
  agentType?: unknown,
): Record<string, any> {
  const metadata = getOpenClawCompatibleAgentMetadata(agentType)
  const normalizedConfig: Record<string, any> = {
    ...(customConfig || {}),
    agent_type: metadata.agentType,
    hostKind: metadata.hostKind,
  }

  const runnerCommand = normalizedConfig.runnerCommand
  const runnerCommandBlank = runnerCommand == null || String(runnerCommand).trim() === ''
  if (metadata.runnerCommand && runnerCommandBlank) {
    normalizedConfig.runnerCommand = metadata.runnerCommand
  }

  return normalizedConfig
}

export const BACKEND_AGENT_TYPE = {
  AGENT: 0,
  WORKFLOW: 1,
  ASSISTANT: 2,
} as const

export const AGENT_MODES = {
  CHAT: 'chat',
  COMPLETION: 'completion',
  ASSISTANT: 'assistant',
} as const

// ==================== 模型配置相关常量 ====================

/** 模型值分隔符（用于 channel_id、model_name、channel_type 编码） */
export const MODEL_VALUE_SEPARATOR = "_53aikm_"

/** 技能最大数量 */
export const MAX_SKILLS_COUNT = 6

/** 拒答策略类型 */
export const OUT_REPLY_TYPE = {
  FIXED_REPLY: "fixed_reply",
  CONTINUE: "continue",
} as const

// ==================== 默认配置 ====================

/** 默认重排序配置 */
export const DEFAULT_RERANK_CONFIG = {
  top_k: 20,
  rerank_channel_id: 0,
  rerank_model_name: "",
  reranking_enable: true,
  score_threshold: 0,
  score_threshold_enabled: false,
}

/** 默认快速推理配置 */
export const DEFAULT_FAST_REASONING_CONFIG = {
  enable: true,
  channel_id: 0,
  channel_type: 0,
  model_name: "",
  temperature: 0.7,
}

/** 默认深度思考配置 */
export const DEFAULT_DEEP_THINKING_CONFIG = {
  enable: false,
  channel_id: 0,
  channel_type: 0,
  model_name: "",
  temperature: 0.7,
}

/** 输入字段类型项 */
export interface FieldTypeItem {
  label: string
  type: string
  allowed?: string[]
}

/** 输入字段类型列表 */
export const inputTypeList: FieldTypeItem[] = [
  {
    label: 'variable_type.text',
    type: 'text',
  },
  {
    label: 'variable_type.textarea',
    type: 'textarea',
  },
  {
    label: 'variable_type.inputNumber',
    type: 'inputNumber',
  },
  {
    label: 'variable_type.select',
    type: 'select',
  },
  { label: 'variable_type.date', type: 'date', allowed: ['53ai_workflow'] },
  { label: 'variable_type.tag', type: 'tag', allowed: ['53ai_workflow'] },
  { label: 'variable_type.file', type: 'file' },
  {
    label: 'variable_type.array_text',
    type: 'array_text',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: 'variable_type.array_image',
    type: 'array_image',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: 'variable_type.array_audio',
    type: 'array_audio',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: 'variable_type.array_video',
    type: 'array_video',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: 'variable_type.array_file',
    type: 'array_file',
    allowed: ['coze_workflow_cn'],
  },
]

/** 输出字段类型列表 */
export const outputTypeList: FieldTypeItem[] = [
  { label: 'variable_type.textarea', type: 'textarea' },
  { label: 'variable_type.image', type: 'image' },
  { label: 'variable_type.audio', type: 'audio' },
  { label: 'variable_type.video', type: 'video' },
  { label: 'variable_type.markdown', type: 'markdown' },
  { label: 'variable_type.array_text', type: 'array_text' },
  { label: 'variable_type.array_image', type: 'array_image' },
  { label: 'variable_type.array_audio', type: 'array_audio' },
  { label: 'variable_type.array_video', type: 'array_video' },
]
