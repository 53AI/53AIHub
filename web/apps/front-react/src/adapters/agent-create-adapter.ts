import type { IAgentCreateAdapter, AgentFormData, GroupOption, AgentFormRef } from '@km/shared-business/agent-create'
import { AgentForm, Chat as SharedChat, buildKnowledgeSourcePayload } from '@km/shared-business/agent-create'
import {
  getOpenClawCompatibleChannelType,
  isOpenClawCompatibleAgentType,
  normalizeOpenClawCompatibleCustomConfig,
  resolveOpenClawCompatibleAgentLogo,
  resolveOpenClawCompatibleAgentTypeFromRecord,
} from '@km/shared-business/agent-create'
import agentApi, { transform53aiBotItem, transformTencentAppItem } from '@/api/modules/agent'
import agentsApi from '@/api/modules/agents'
import { AGENT_TYPES, AGENT_MODES, getAgentByAgentType, CHANNEL_TYPE_VALUE_MAP, type AgentType } from '@/constants/platform/config'
import { PreviewPanel } from '@/views/agent/create-v2/Preview'
import { OpenClawEmbeddedChatWorkspace } from '@/views/agent/create-v2/OpenClawEmbeddedChatWorkspace'
import { t } from '@/locales'
import { generateRandomId, copyToClip } from '@km/shared-utils'
import { ImageUpload } from '@/components/ImageUpload'
import channelApi, { transformSelectData } from '@/api/modules/channel'
import conversationApi from '@/api/modules/conversation'
import chatApi from '@/api/modules/chat'
import uploadApi from '@/api/modules/upload'
import { XBubbleList, XBubbleUser, XBubbleAssistant, XIcon, XSender } from '@km/hub-ui-x-react'
import { api_host, lib_host } from '@/utils/config'
import { isOpLocalEnv, isPrivatePrem } from '@/utils/config'

// ==================== 数据转换 ====================

const DEFAULT_COMPLETION_PARAMS = {
  temperature: 0.2,
  top_p: 0.75,
  presence_penalty: 0.5,
  frequency_penalty: 0.5,
}

/** 转换 API 响应到表单数据 */
export function transformToFormData(data: any): AgentFormData {
  const openClawAgentType = resolveOpenClawCompatibleAgentTypeFromRecord(data)
  const agentType = openClawAgentType || data.custom_config?.agent_type || 'prompt'
  const agentOptionData = getAgentByAgentType(agentType as AgentType)

  // Openclaw 类型：保持接口原始数据，不填充默认值
  const isOpenclaw = Boolean(openClawAgentType) || isOpenClawCompatibleAgentType(agentType)
  const openClawCustomConfig = isOpenclaw
    ? normalizeOpenClawCompatibleCustomConfig(data.custom_config, openClawAgentType || agentType)
    : undefined
  
  return {
    agent_id: data.agent_id,
    bot_id: data.bot_id || '',
    logo: isOpenclaw ? resolveOpenClawCompatibleAgentLogo(data.logo, agentType) : (data.logo || agentOptionData?.icon || ''),
    name: data.name || '',
    group_id: +data.group_id || 0,
    description: data.description || '',
    channel_type: isOpenclaw ? getOpenClawCompatibleChannelType(openClawAgentType || agentType) : (+data.channel_type || 0),
    model: data.model || '',
    sort: +data.sort || 0,
    prompt: data.prompt || '',
    user_group_ids: data.user_group_ids || [],
    subscription_group_ids: data.subscription_group_ids || [],
    tools: data.tools || [],
    use_cases: data.use_cases || [],
    configs: isOpenclaw
      ? data.configs
      : (data.configs && Object.keys(data.configs).length > 0
        ? data.configs
        : { completion_params: DEFAULT_COMPLETION_PARAMS }),
    enable: !!+data.enable || false,
    custom_config: isOpenclaw
      ? openClawCustomConfig!
      : {
          agent_type: agentType,
          provider_id: 0,
          channel_id: 0,
          coze_workspace_id: '',
          coze_bot_id: '',
          coze_bot_url: '',
          tencent_bot_id: '',
          app_builder_bot_id: '',
          chat53ai_agent_id: '',
          channel_config: {},
          ...(data.custom_config || {}),
        },
    settings: isOpenclaw
      ? data.settings
      : {
          opening_statement: '',
          suggested_questions: [],
          file_parse: { enable: false },
          image_parse: { vision: false, enable: false },
          relate_agents: [],
          input_fields: [],
          output_fields: [],
          ...(data.settings || {}),
        },
    // 时间戳
    created_time: data.created_time,
    updated_time: data.updated_time,
  }
}

/** 转换表单数据到 API 请求 */
function transformToSaveData(formData: AgentFormData): any {
  const {
    agent_id,
    bot_id,
    logo,
    name,
    group_id,
    description,
    model,
    channel_type,
    prompt,
    sort,
    tools,
    use_cases,
    user_group_ids,
    subscription_group_ids,
    configs,
    custom_config,
    settings,
    enable,
  } = formData

  // Openclaw 类型：保持原始数据，不填充默认值
  const isOpenclaw = isOpenClawCompatibleAgentType(custom_config?.agent_type)

  const data: any = {
    agent_id: agent_id || 0,
    agent_type: 0, // 默认为 AGENT (chat 类型)
    channel_type,
    model,
    logo,
    name,
    group_id: +group_id || 0,
    description,
    sort,
    prompt,
    user_group_ids,
    subscription_group_ids,
    use_cases,
    tools,
    configs,
    custom_config,
    settings,
    enable,
  }

  // 根据平台类型处理 model
  const agentConfig = getAgentByAgentType(custom_config?.agent_type as AgentType)

  if (isOpenclaw) {
    data.channel_type = getOpenClawCompatibleChannelType(custom_config?.agent_type)
    data.model = 'openclaw-ws'
  } else if (!channel_type) {
    data.channel_type = custom_config?.agent_type ? CHANNEL_TYPE_VALUE_MAP.get(custom_config.agent_type) || 0 : 0
  }

  switch (custom_config?.agent_type) {
    case AGENT_TYPES.PROMPT:
      data.custom_config.channel_id = +model.split('_53aikm_')[0] || 0
      data.model = model.split('_53aikm_')[1] || ''
      data.channel_type = +model.split('_53aikm_')[2] || 0
      break
    case AGENT_TYPES.COZE_AGENT_CN:
      data.model = custom_config.coze_bot_id || ''
      break
    case AGENT_TYPES.COZE_WORKFLOW_CN:
      const params = new URLSearchParams(custom_config.coze_bot_url?.split('?')[1] || '')
      data.model = `workflow-${params.get('workflow_id')}` || ''
      break
    case AGENT_TYPES.APP_BUILDER:
      data.model = custom_config.app_builder_bot_id || ''
      break
    case AGENT_TYPES.TENCENT:
      data.model = `bot-${custom_config.tencent_bot_id}` || ''
      break
    case AGENT_TYPES['53AI_AGENT']:
      data.model = custom_config.chat53ai_agent_id || ''
      break
    case AGENT_TYPES['53AI_WORKFLOW']:
      data.model = `workflow-${custom_config.chat53ai_agent_id}` || ''
      break
  }

  // 设置 agent_type
  // Openclaw 类型特殊处理：agent_type = 2, agent_mode = 'assistant'
  if (isOpenclaw) {
    data.agent_type = 2 // Openclaw 专用类型
    data.custom_config.agent_mode = 'assistant'
  } else if (agentConfig && agentConfig.mode === AGENT_MODES.COMPLETION) {
    data.agent_type = 1 // WORKFLOW
    data.custom_config.agent_mode = agentConfig?.mode || 'chat'
  } else {
    data.custom_config.agent_mode = agentConfig?.mode || 'chat'
  }

  data.custom_config.agent_type = custom_config?.agent_type

  return data
}

// ==================== 适配器实现 ====================

export const frontAgentAdapter: IAgentCreateAdapter = {
  // ========== 能力声明 ==========

  supportedPlatforms: [
    AGENT_TYPES.PROMPT,
    AGENT_TYPES.COZE_AGENT_CN,
    AGENT_TYPES.COZE_WORKFLOW_CN,
    AGENT_TYPES.COZE_AGENT_OSV,
    AGENT_TYPES.COZE_WORKFLOW_OSV,
    AGENT_TYPES.DIFY_AGENT,
    AGENT_TYPES.DIFY_WORKFLOW,
    AGENT_TYPES.FASTGPT_AGENT,
    AGENT_TYPES.FASTGPT_WORKFLOW,
    AGENT_TYPES.MAXKB_AGENT,
    AGENT_TYPES.N8N_WORKFLOW,
    AGENT_TYPES.TENCENT,
    AGENT_TYPES.VOLCENGINE,
    AGENT_TYPES.BAILIAN,
    AGENT_TYPES.APP_BUILDER,
    AGENT_TYPES['53AI_AGENT'],
    AGENT_TYPES['53AI_WORKFLOW'],
    AGENT_TYPES.YUANQI,
    AGENT_TYPES.OPENCLAW,
    AGENT_TYPES.QCLAW,
    AGENT_TYPES.CODEX,
    AGENT_TYPES.MANUS,
  ] as string[],

  defaultPlatform: AGENT_TYPES.PROMPT as string,

  visibleConfigKeys: [
    'model',
    'prompt',
    'tools',
    'relate_agents',
    'input_fields',
    'output_fields',
    'file_parse',
    'image_parse',
    'opening_statement',
    'suggested_questions',
  ],

  // ========== API 操作 ==========

  async getDetail(agentId: number | string): Promise<AgentFormData> {
    const data = await agentApi.detail({ data: { agent_id: agentId } })
    return transformToFormData(data)
  },

  async save(formData: AgentFormData): Promise<AgentFormData> {
    const saveData = transformToSaveData(formData)
    const result = await agentApi.save({ data: saveData })
    return transformToFormData(result)
  },

  async getGroupOptions(): Promise<GroupOption[]> {
    // front-react 用户端可能不需要分组选择
    return []
  },

  async delete(agentId: string | number): Promise<void> {
    await agentApi.delete({ data: { agent_id: String(agentId) } })
  },

  // ========== 数据转换 ==========

  filterFormData(data: AgentFormData): AgentFormData {
    return data
  },

  // ========== 平台配置 ==========

  getAgentConfig(platform: string) {
    const config = getAgentByAgentType(platform as AgentType)
    return {
      icon: config?.icon || '',
      name: config?.name || '',
      channelName: config?.channelName || '',
      channelType: config?.channelType || 0,
      mode: config?.mode || 'chat',
    }
  },

  async getPlatformConfig(params) {
    const { platform, provider_id, workspace_id, bot_id, agent_id, type } = params
    switch (platform) {
      case AGENT_TYPES.COZE_AGENT_CN:
      case AGENT_TYPES.COZE_WORKFLOW_CN:
        if (type === 'providers') {
          const list = await agentApi.providers.list({ provider_type: 1 })
          return { providers: (list || []).map((item: any) => ({ provider_id: item.provider_id, name: item.name })) }
        }
        if (type === 'bots' && workspace_id) {
          const list = await agentApi.coze.bots_list(workspace_id, { provider_id })
          return { bots: list || [] }
        }
        return agentApi.coze.workspaces_list({ provider_id })
      case AGENT_TYPES.COZE_AGENT_OSV:
      case AGENT_TYPES.COZE_WORKFLOW_OSV:
        if (type === 'providers') {
          const list = await agentApi.providers.list({ provider_type: 5 })
          return { providers: (list || []).map((item: any) => ({ provider_id: item.provider_id, name: item.name })) }
        }
        return null
      case AGENT_TYPES.APP_BUILDER:
        if (type === 'providers') {
          const list = await agentApi.providers.list({ provider_type: 3 })
          return { providers: (list || []).map((item: any) => ({ provider_id: item.provider_id, name: item.name })) }
        }
        return agentApi.appbuilder.bots_list({ provider_id })
      case AGENT_TYPES['53AI_AGENT']:
      case AGENT_TYPES['53AI_WORKFLOW']: {
        if (type === 'providers') {
          const list = await agentApi.providers.list({ provider_type: 4 })
          return { providers: (list || []).map((item: any) => ({ provider_id: item.provider_id, name: item.name })) }
        }
        if (type === 'input_fields') {
          const res = await agentApi.chat53ai.workflow_field_list(String(agent_id || ''), { provider_id })
          const fields = (res?.user_input_form || []).map((item: any) => Object.values(item)[0])
          return { input_fields: fields }
        }
        if (platform === AGENT_TYPES['53AI_AGENT']) {
          const list = await agentApi.chat53ai.bots_list({ provider_id })
          return { bots: (list || []).map(transform53aiBotItem) }
        }
        const list = await agentApi.chat53ai.workflow_list({ provider_id })
        return { workflows: (list || []).map(transform53aiBotItem) }
      }
      case AGENT_TYPES.TENCENT: {
        if (type === 'providers') {
          const list = await agentApi.providers.list({ provider_type: 6 })
          return { providers: (list || []).map((item: any) => ({ provider_id: item.provider_id, name: item.name })) }
        }
        const list = await agentApi.tencent.bots_list({ provider_id })
        return { bots: (list || []).map(transformTencentAppItem) }
      }
      default:
        return null
    }
  },

  async getAgentList(params) {
    const { group_id, keyword, offset, limit } = params
    const result = await agentApi.list({
      params: {
        group_id: String(group_id || 0),
        keyword,
        offset: offset || 0,
        limit: limit || 20,
      }
    })
    return {
      count: result.count || 0,
      agents: result.agents || [],
    }
  },

  async getAgentModels(agentId) {
    // preview 用：返回后端分配的 agent_models 列表（每条带独立 id），
    // useAgentPreviewSender 按 value 匹配后取 id 作为 modelId
    const res = await agentsApi.models.list(String(agentId))
    return res.agent_models || []
  },

  async loadModels() {
    // front-react 使用公共渠道获取模型列表
    const channels = await channelApi.listv2()
    return channels.map(channel => {
      const transformed = transformSelectData(channel)
      return {
        value: String(channel.channel_id),
        label: transformed.platform_name || '',
        icon: transformed.platform_icon || '',
        options: (transformed.options || []).map((opt: any) => ({
          value: opt.value,
          model_value: opt.model_value || opt.value,
          label: opt.label,
          icon: opt.icon,
          vision: opt.vision || false,
        })),
      }
    })
  },

  // ========== UI 组件注入 ==========

  AgentFormComponent: AgentForm as React.ComponentType<{
    agentType: string
    showChannelConfig?: boolean
    className?: string
    ref?: React.Ref<AgentFormRef>
  }>,

  // ========== 工具函数注入 ==========

  t,
  generateRandomId,
  ImageUploadComponent: ImageUpload as React.ComponentType<{
    className?: string
    value?: string
    onChange?: (url: string) => void
  }>,

  PreviewComponent: PreviewPanel as React.ComponentType<{
    ref?: any
  }>,

  InlinePreviewComponent: SharedChat as React.ComponentType<{
    className?: string
  }>,

  OpenClawPreviewComponent: OpenClawEmbeddedChatWorkspace,

  // ========== 企业信息 ==========

  isIndependent: false,
  isIndustry: false,
  isEnterprise: false,

  // 本地版（op-local）与私有化版（VITE_PRIVATE_PREM=true）隐藏知识图谱入口
  get hideKnowledgeGraph() { return isOpLocalEnv || isPrivatePrem },

  // ========== 分组类型常量 ==========

  GROUP_TYPE: {
    USER: 'user',
    INTERNAL_USER: 'internal_user',
    AGENT: 'agent',
  },

  // ========== 分组选择组件（front-react 不需要） ==========

  // GroupSelectComponent 和 GroupTabsComponent 在 front-react 用户端不需要

  // ========== 公共路径 ==========

  getPublicPath: (path: string) => {
    // front-react 的静态资源路径
    return `/static${path}`
  },

  // ========== API Host ==========

  apiHost: api_host,

  // ========== Markdown 编辑器配置 ==========

  markdownEditorConfig: {
    cdn: `${lib_host}/js/vditor`,
    apiHost: api_host,
  },

  // ========== Openclaw 密钥重置 ==========

  resetSecret: async (agentId: string | number) => {
    const data = await agentsApi.my.resetSecret(String(agentId))
    return { secret: data.secret }
  },

  // ========== 复制到剪贴板 ==========

  copyToClip,

  // ========== AGENT_TYPES 常量 ==========

  AGENT_TYPES,

  // ========== 会话/预览相关 API ==========

  createConversation: async (data) => {
    const res = await conversationApi.create({
      agent_id: String(data.agent_id),
      title: data.title || '',
      conversation_type: data.conversation_type as any,
    }) as any
    return { conversation_id: res.data?.conversation_id || res.conversation_id }
  },

  sendChatMessage: async (params) => {
    const completionParams = params.agent_configs?.completion_params || {
      temperature: 0.2,
      top_p: 0.75,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    }

    // minimal 模式：普通智能体（agent.json）。不带 enable_process_steps /
    // knowledge_base_ids / file_ids / search_config 等知识库相关字段。
    const isMinimal = params.type === 'agent' || params.minimalParams === true

    const model = `agent-${params.agent_id}${params.modelId ? `-${params.modelId}` : ''}`
    const rerankConfig = params.agentInfo?.settings?.rerank_config || {}
    const webSearchConfig = params.agentInfo?.settings?.web_search_setting || {}

    const basePayload = {
      conversation_id: String(params.conversation_id),
      model,
      messages: params.messages,
      frequency_penalty: completionParams.frequency_penalty || 0,
      presence_penalty: completionParams.presence_penalty || 0,
      stream: true,
      temperature: completionParams.temperature || 0,
      top_p: completionParams.top_p || 0,
    }

    // full 模式：工作台 AI / AI 搜问（workbench.json / knowledge.json）。
    // 拼齐 enable_process_steps + 知识库/文件/空间 ID + 搜索/图谱配置。

    const payload = isMinimal
      ? basePayload
      : {
          ...basePayload,
          enable_process_steps: true,
          knowledge_base_ids: params.knowledgeSource?.state?.networkSearch
            ? []
            : params.knowledgeSource?.state?.allKnowledge
              ? ['all']
              : (params.library?.value ?? ['']),
          file_ids: [],
          space_ids: [],
          solo_file_mode: false,
          search_config: {
            ...rerankConfig,
            top_k: params.knowledgeSource?.state?.networkSearch
              ? webSearchConfig.top_k ?? rerankConfig.top_k
              : rerankConfig.top_k,
          },
          ...(params.knowledgeSource ? buildKnowledgeSourcePayload(params.knowledgeSource) : {}),
        }

    await chatApi.completions(payload, {
      responseType: 'stream',
      isStream: true,
      onDownloadProgress: params.onDownloadProgress,
      signal: params.signal,
    })
  },

  uploadFile: async (file) => {
    const res = await uploadApi.upload(file)
    return {
      id: res.data.id,
      url: `${api_host}/api/preview/${res.data.preview_key || ''}`,
      size: res.data.size,
      name: res.data.file_name,
      mime_type: res.data.mime_type,
    }
  },

  // ========== 消息气泡组件库 ==========

  BubbleComponents: {
    XBubbleList,
    XBubbleUser,
    XBubbleAssistant,
    XIcon,
    XSender,
  },
}
