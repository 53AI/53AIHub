import type { AgentTypeOption, AgentPlatformOption } from './adapters/types'
import {
  BACKEND_AGENT_TYPE,
  AGENT_MODES,
  OPENCLAW_COMPATIBLE_CREATABLE_AGENT_TYPES,
  OPENCLAW_COMPATIBLE_AGENT_METADATA,
  getOpenClawCompatibleAgentIconPath,
} from './constants'

export const AGENT_TYPE_OPTIONS: AgentTypeOption[] = [
  {
    label: '助理型',
    value: 'assistant',
    icon: 'agent',
    desc: '安装企业专属Skill的智能体，可在多场景下自动响应用户请求，完成特定任务',
    subLabel: '（Action Agents）',
    agent_type: BACKEND_AGENT_TYPE.ASSISTANT,
    agent_mode: AGENT_MODES.ASSISTANT,
  },
  {
    label: '对话型',
    value: 'chatbot',
    icon: 'chat_v2',
    desc: '用户与大模型进行对话，由一个大模型自主思考决策，适用于较为简单的业务逻辑。',
    subLabel: '（ChatBot）',
    agent_type: BACKEND_AGENT_TYPE.AGENT,
    agent_mode: AGENT_MODES.CHAT,
  },
  {
    label: '应用型',
    value: 'workflow',
    icon: 'app-one',
    desc: '工作流是一系列可执行指令的集合，用于实现业务逻辑或完成特定任务。',
    subLabel: '（WorkFlow）',
    agent_type: BACKEND_AGENT_TYPE.WORKFLOW,
    agent_mode: AGENT_MODES.COMPLETION,
  },
]

function createPlatformOption(
  value: string,
  label: string,
  icon: string,
  channel_type: number,
  agent_type: number = 0,
  agent_mode: string = 'chat',
  agent_usage: number = 0,
): AgentPlatformOption {
  return { value, label, icon, channel_type, agent_type, agent_mode, agent_usage }
}

/**
 * 创建平台配置（后台管理）
 * @param imgHost 图片服务器地址，如 `${api_host}/api/images`
 * @param getPublicPath 可选的公共路径转换函数，用于处理基础路径前缀
 */
export function createPlatformsByType(
  imgHost: string,
  getPublicPath?: (path: string) => string,
): AgentPlatformOption[] {
  const getIconUrl = (path: string): string => `${imgHost}${path}`
  const openClawCompatiblePlatforms = OPENCLAW_COMPATIBLE_CREATABLE_AGENT_TYPES.map((agentType) =>
    createPlatformOption(agentType, OPENCLAW_COMPATIBLE_AGENT_METADATA[agentType].label, getOpenClawCompatibleAgentIconPath(agentType, getPublicPath), OPENCLAW_COMPATIBLE_AGENT_METADATA[agentType].channelType, BACKEND_AGENT_TYPE.ASSISTANT, AGENT_MODES.ASSISTANT),
  )

  return [
    ...openClawCompatiblePlatforms,
    createPlatformOption('workbench', '小助理', getIconUrl('/agent/workbench.png'), 0, BACKEND_AGENT_TYPE.ASSISTANT, AGENT_MODES.ASSISTANT, 4),
    { ...createPlatformOption('knowledge', 'AI搜问', getIconUrl('/agent/knowledge.png'), 0, BACKEND_AGENT_TYPE.ASSISTANT, AGENT_MODES.ASSISTANT, 1), hidden: true },
    createPlatformOption('prompt', '智能问答', getIconUrl('/agent/prompt.png'), 0, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('coze_agent_cn', '扣子编程', getIconUrl('/agent/coze_agent_cn.png'), 34, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('53ai_agent', '53AI Studio', getIconUrl('/agent/53ai_agent.png'), 1002, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('coze_agent_osv', 'coze-studio开源版', getIconUrl('/agent/coze_agent_osv.png'), 1010, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('fastgpt_agent', 'FastGPT', getIconUrl('/agent/fastgpt_agent.png'), 22, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('dify_agent', 'Dify', getIconUrl('/agent/dify_agent.png'), 1001, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('yuanqi', '腾讯元器', getIconUrl('/agent/yuanqi.png'), 1006, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('maxkb_agent', 'MaxKB', getIconUrl('/agent/maxkb_agent.png'), 1008, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('app_builder', '百度千帆', getIconUrl('/agent/app_builder.png'), 1005, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('bailian', '阿里百炼', getIconUrl('/agent/bailian.png'), 1003, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('volcengine', '火山方舟', getIconUrl('/agent/volcengine.png'), 1004, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),
    createPlatformOption('tencent', '腾讯云智能体开发平台', getIconUrl('/agent/tencent.png'), 1011, BACKEND_AGENT_TYPE.AGENT, AGENT_MODES.CHAT),

    createPlatformOption('coze_workflow_cn', '扣子编程', getIconUrl('/agent/coze_workflow_cn.png'), 34, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
    createPlatformOption('53ai_workflow', '53AI Studio', getIconUrl('/agent/53ai_workflow.png'), 1002, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
    createPlatformOption('coze_workflow_osv', 'coze-studio开源版', getIconUrl('/agent/coze_workflow_osv.png'), 1010, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
    createPlatformOption('fastgpt_workflow', 'FastGPT', getIconUrl('/agent/fastgpt_agent.png'), 22, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
    createPlatformOption('dify_workflow', 'Dify', getIconUrl('/agent/dify_workflow.png'), 1001, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
    createPlatformOption('n8n_workflow', 'n8n', getIconUrl('/agent/n8n_workflow.png'), 1009, BACKEND_AGENT_TYPE.WORKFLOW, AGENT_MODES.COMPLETION),
  ]
}

/**
 * 创建平台配置（前台用户）
 * @param imgHost 图片服务器地址，如 `${api_host}/api/images`
 * @param getPublicPath 可选的公共路径转换函数，用于处理基础路径前缀
 */
export function createFrontPlatformsByType(
  _imgHost: string,
  getPublicPath?: (path: string) => string,
): AgentPlatformOption[] {
  return OPENCLAW_COMPATIBLE_CREATABLE_AGENT_TYPES.map((agentType) =>
    createPlatformOption(agentType, OPENCLAW_COMPATIBLE_AGENT_METADATA[agentType].label, getOpenClawCompatibleAgentIconPath(agentType, getPublicPath), OPENCLAW_COMPATIBLE_AGENT_METADATA[agentType].channelType, BACKEND_AGENT_TYPE.ASSISTANT, AGENT_MODES.ASSISTANT),
  )
}

export function createConsoleTypeOptions(): AgentTypeOption[] {
  return AGENT_TYPE_OPTIONS.map((type) => ({ ...type, disabled: false }))
}

export function createFrontTypeOptions(): AgentTypeOption[] {
  return AGENT_TYPE_OPTIONS.map((type, index) => ({
    ...type,
    disabled: index !== 0,
  }))
}
