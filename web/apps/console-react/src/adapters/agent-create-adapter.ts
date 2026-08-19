import type { IAgentCreateAdapter, AgentFormData, GroupOption, AgentFormRef, ChannelOption, ScopeItem } from '@km/shared-business/agent-create'
import { AgentForm, Chat as SharedChat, buildKnowledgeSourcePayload } from '@km/shared-business/agent-create'
import {
  getOpenClawCompatibleChannelType,
  isOpenClawCompatibleAgentType,
  normalizeOpenClawCompatibleCustomConfig,
  resolveOpenClawCompatibleAgentLogo,
  resolveOpenClawCompatibleAgentTypeFromRecord,
} from '@km/shared-business/agent-create'
import { agentApi, transform53aiBotItem, transformTencentAppItem, transformAppBuilderBotItem, transformCozeBotItem, transformCozeWorkspaceItem } from '@/api/modules/agent'
import agentsApi from '@/api/modules/agents'
import { groupApi } from '@/api/modules/group'
import providersApi, { transformProviderList } from '@/api/modules/providers'
import channelApi, { transformSelectData } from '@/api/modules/channel'
import { AGENT_TYPES, getAgentByAgentType, BACKEND_AGENT_TYPE, AGENT_MODES, MODEL_USE_TYPE } from '@/constants/platform/config'
import type { AgentType } from '@/constants/platform/config'
import { GROUP_TYPE } from '@/constants/group'
import { CHANNEL_TYPE_VALUE_MAP } from '@/constants/platform/channel'
import { AGENT_USAGES } from '@/constants/agent'
import { PageLayoutContent } from '@/components/PageLayout'
import { AgentPreview } from '@/views/agent/create/components/layout/Preview'
import { ConsoleOpenClawEmbeddedChatWorkspace } from '@/views/agent/create-v2/OpenClawEmbeddedChatWorkspace'
import { UseScope } from '@/views/agent/create/components/shared/UseScope'
import { t } from '@/locales'
import { generateRandomId } from '@/utils'
import { copyToClip } from '@km/shared-utils'
import { lib_host, api_host, img_host, isOpLocal, isPrivatePrem } from '@/utils/config'
import { buildPreviewUrl } from '@/utils/preview'
import { ImageUpload } from '@/components/Upload/image'
import { GroupSelect } from '@/components/GroupSelect'
import { GroupTabs } from '@/components/GroupTabs'
import { useEnterpriseStore, useConversationStore } from '@/stores'
import { conversationApi } from '@/api/modules/conversation'
import uploadApi from '@/api/modules/upload'
import { XBubbleList, XBubbleUser, XBubbleAssistant, XIcon, XSender } from '@km/hub-ui-x-react'
import { SkillPicker } from '@/components/SkillPicker'
import { skillApi } from '@/api/modules/skill'
import { MarkdownEditor } from '@/components/Markdown/editor'
import { PromptInput } from '@/components/Prompt/input'
import { SelectPlus } from '@/components/SelectPlus'
import { ModelSelectPopover } from '@/components/Model/select-popover'
import platformSettingsApi, { transformPlatformSetting } from '@/api/modules/platform-settings'

// ==================== 数据转换 ====================

const DEFAULT_COMPLETION_PARAMS = {
  temperature: 0.2,
  top_p: 0.75,
  presence_penalty: 0.5,
  frequency_penalty: 0.5,
}

const KNOWLEDGE_LOGO = `${img_host}/agent/knowledge.png`
const WORKBENCH_LOGO = `${img_host}/agent/workbench.png`

// ==================== 模型配置保存 ====================

/**
 * 保存模型配置（小助理/AI搜问专用）
 * 小助理保存: fast_reasoning_config + skill_run_config
 * AI搜问保存: fast_reasoning_config + deep_thinking_config
 */
async function saveModelsBatch(agentId: string | number, formData: AgentFormData) {
  const settings = formData.settings || {}
  const modelList: Array<{ channel_id: number; channel_type: number; model: string }> = []

  const agentType = formData.custom_config?.agent_type

  if (agentType === AGENT_TYPES.WORKBENCH) {
    // 小助理: 规划推理模型 + 技能执行模型
    const fastConfig = settings.fast_reasoning_config
    const skillConfig = settings.skill_run_config

    if (fastConfig?.channel_id && fastConfig?.model_name) {
      modelList.push({
        channel_id: fastConfig.channel_id,
        channel_type: fastConfig.channel_type || 0,
        model: fastConfig.model_name,
      })
    }
    if (skillConfig?.channel_id && skillConfig?.model_name) {
      modelList.push({
        channel_id: skillConfig.channel_id,
        channel_type: skillConfig.channel_type || 0,
        model: skillConfig.model_name,
      })
    }
  } else if (agentType === AGENT_TYPES.KNOWLEDGE) {
    // AI搜问: 快速推理模型 + 深度思考模型
    const fastConfig = settings.fast_reasoning_config
    const deepConfig = settings.deep_thinking_config

    if (fastConfig?.channel_id && fastConfig?.model_name) {
      modelList.push({
        channel_id: fastConfig.channel_id,
        channel_type: fastConfig.channel_type || 0,
        model: fastConfig.model_name,
      })
    }
    if (deepConfig?.enable && deepConfig?.channel_id && deepConfig?.model_name) {
      modelList.push({
        channel_id: deepConfig.channel_id,
        channel_type: deepConfig.channel_type || 0,
        model: deepConfig.model_name,
      })
    }
  }

  if (modelList.length > 0) {
    await agentsApi.models.batch({
      agent_id: agentId,
      models: modelList,
    })
  }
}

/**
 * 保存技能配置（小助理专用）
 * - 新建模式：批量调用 addAgentBuiltinSkill
 * - 编辑模式：对比 initial_skills 和当前 skills，计算差异后调用 add/delete
 */
async function saveSkillsBatch(agentId: string | number, formData: AgentFormData) {
  const settings = formData.settings || {}
  const currentSkills = settings.skills || []
  const initialSkills = settings.initial_skills || []

  // 判断是否是编辑模式（initial_skills 存在且不为空）
  const isEditMode = initialSkills.length > 0

  if (isEditMode) {
    // 编辑模式：计算差异
    // 找出需要新增的技能（在 current 中但不在 initial 中）
    const toAdd = currentSkills.filter((skill: any) => {
      const skillLibraryId = skill.skill_library_id || skill.id
      return !initialSkills.some((s: any) => (s.skill_library_id || s.id) === skillLibraryId)
    })

    // 找出需要删除的技能（在 initial 中但不在 current 中）
    const toDelete = initialSkills.filter((skill: any) => {
      const skillLibraryId = skill.skill_library_id || skill.id
      return !currentSkills.some((s: any) => (s.skill_library_id || s.id) === skillLibraryId)
    })

    // 执行新增
    for (const skill of toAdd) {
      const skillLibraryId = skill.skill_library_id || skill.id
      if (skillLibraryId) {
        await skillApi.addAgentBuiltinSkill(String(agentId), String(skillLibraryId))
      }
    }

    // 执行删除
    for (const skill of toDelete) {
      const bindingId = skill.binding_id
      if (bindingId) {
        await skillApi.deleteAgentBuiltinSkill(String(agentId), String(bindingId))
      }
    }
  } else {
    // 新建模式：批量添加所有技能
    for (const skill of currentSkills) {
      const skillLibraryId = skill.skill_library_id || skill.id
      if (skillLibraryId) {
        await skillApi.addAgentBuiltinSkill(String(agentId), String(skillLibraryId))
      }
    }
  }
}

/** 转换 API 响应到表单数据 */
export function transformToFormData(data: any): AgentFormData {
  data.custom_config = data.custom_config || {}
  if (data.agent_usage === AGENT_USAGES.WORK_AI) {
    data.logo = data.logo || WORKBENCH_LOGO
    data.name = data.name || t('agent_app.workbench')
    data.custom_config.agent_type = AGENT_TYPES.WORKBENCH
    data.backend_agent_type = BACKEND_AGENT_TYPE.ASSISTANT
  } else if (data.agent_usage === AGENT_USAGES.KM_AI_SEARCH) {
    data.logo = data.logo || KNOWLEDGE_LOGO
    data.name = data.name || t('agent_app.knowledge')
    data.custom_config.agent_type = AGENT_TYPES.KNOWLEDGE
    data.backend_agent_type = BACKEND_AGENT_TYPE.ASSISTANT
  }
  const openClawAgentType = resolveOpenClawCompatibleAgentTypeFromRecord(data)

  const agentType = openClawAgentType || data.custom_config?.agent_type || 'prompt'
  const agentOptionData = getAgentByAgentType(agentType as AgentType)
  const isOpenclaw = Boolean(openClawAgentType) || isOpenClawCompatibleAgentType(agentType)
  const openClawCustomConfig = isOpenclaw
    ? normalizeOpenClawCompatibleCustomConfig(data.custom_config, openClawAgentType || agentType)
    : undefined

  // prompt 类型需要将 model 转换为 model_value 格式
  let model = data.model || ''
  if (!isOpenclaw && agentType === AGENT_TYPES.PROMPT) {
    const customConfig = data.custom_config || {}
    model = `${customConfig.channel_id}_53aikm_${data.model}_53aikm_${data.channel_type}` || ''
  }

  return {
    agent_usage: data.agent_usage,
    agent_id: data.agent_id,
    bot_id: data.bot_id || '',
    logo: isOpenclaw ? resolveOpenClawCompatibleAgentLogo(data.logo, agentType) : (data.logo || agentOptionData?.icon || ''),
    name: data.name || '',
    group_id: +data.group_id || 0,
    description: data.description || '',
    channel_type: isOpenclaw ? getOpenClawCompatibleChannelType(openClawAgentType || agentType) : (+data.channel_type || 0),
    model,
    sort: +data.sort || 0,
    prompt: data.prompt || '',
    user_group_ids: data.user_group_ids || [],
    subscription_group_ids: data.subscription_group_ids || [],
    scopes: data.scopes || [],
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
          channel_config: data.channel_config || {},
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
    // 时间戳字段
    created_time: data.created_time,
    updated_time: data.updated_time,
    // 保留原始的 agent_type 数字（0=对话, 1=补全, 2=助手）
    backend_agent_type: data.backend_agent_type,
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
    scopes,
    configs,
    custom_config,
    settings,
    enable,
  } = formData

  // Openclaw 类型：保持原始数据，不填充默认值
  const isOpenclaw = isOpenClawCompatibleAgentType(custom_config?.agent_type)

  // 助理型平台（workbench/knowledge）
  const isAssistantType = custom_config?.agent_type === AGENT_TYPES.WORKBENCH ||
                           custom_config?.agent_type === AGENT_TYPES.KNOWLEDGE

  const data: any = {
    agent_id: agent_id || 0,
    agent_type: BACKEND_AGENT_TYPE.AGENT, // 默认为 chat 类型
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
    scopes,
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
    data.channel_type = CHANNEL_TYPE_VALUE_MAP.get(custom_config?.agent_type) || 0
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
    case AGENT_TYPES.YUANQI:
      data.model = model || ''
      break
    case AGENT_TYPES.WORKBENCH:
      // 小助理：从 settings.fast_reasoning_config 获取 model
      data.agent_usage = AGENT_USAGES?.WORK_AI || 4
      const workbenchFastConfig = settings?.fast_reasoning_config
      if (workbenchFastConfig?.model_name) {
        data.model = workbenchFastConfig.model_name
        data.channel_type = workbenchFastConfig.channel_type || 0
      }
      break
    case AGENT_TYPES.KNOWLEDGE:
      // AI搜问：从 settings.fast_reasoning_config 获取 model
      data.agent_usage = AGENT_USAGES?.KM_AI_SEARCH || 1
      const knowledgeFastConfig = settings?.fast_reasoning_config
      if (knowledgeFastConfig?.model_name) {
        data.model = knowledgeFastConfig.model_name
        data.channel_type = knowledgeFastConfig.channel_type || 0
      }
      break
  }

  // 设置 agent_type
  // Openclaw 类型特殊处理：agent_type = 2, agent_mode = 'assistant'
  if (isOpenclaw) {
    data.agent_type = BACKEND_AGENT_TYPE.ASSISTANT
    data.custom_config.agent_mode = 'assistant'
  } else if (isAssistantType) {
    // 助理型平台：agent_type = 2, agent_mode = 'assistant'
    data.agent_type = BACKEND_AGENT_TYPE.ASSISTANT
    data.custom_config.agent_mode = 'assistant'
  } else if (agentConfig && agentConfig.mode === AGENT_MODES.COMPLETION) {
    data.agent_type = BACKEND_AGENT_TYPE.WORKFLOW
    data.custom_config.agent_mode = agentConfig?.mode || 'chat'
  } else {
    data.custom_config.agent_mode = agentConfig?.mode || 'chat'
  }

  data.custom_config.agent_type = custom_config?.agent_type

  return data
}

// ==================== 适配器实现 ====================

export const consoleAgentAdapter: IAgentCreateAdapter = {
  // ========== 能力声明 ==========

  supportedPlatforms: [
    AGENT_TYPES.PROMPT,
    AGENT_TYPES.WORKBENCH,
    AGENT_TYPES.KNOWLEDGE,
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
  ] as AgentType[],

  defaultPlatform: AGENT_TYPES.PROMPT as AgentType,

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

    // 参考Vue toolbox版本：需要先加载分组列表，再从 user_group_ids 中过滤出对应的分组ID
    const enterprise = useEnterpriseStore.getState().info
    const allGroupIds = data.user_group_ids || []

    // 并行加载注册用户分组和内部用户分组
    const [subscriptionGroups, internalGroups] = await Promise.all([
      (enterprise.is_independent || enterprise.is_industry)
        ? groupApi.list({ params: { group_type: GROUP_TYPE.USER } }).then(list => (list || []).map((item: any) => item.group_id))
        : Promise.resolve([]),
      (enterprise.is_enterprise || enterprise.is_industry)
        ? groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } }).then(list => (list || []).map((item: any) => item.group_id))
        : Promise.resolve([]),
    ])

    // 更新 data 中的分组字段，根据分组类型拆分
    data.subscription_group_ids = allGroupIds.filter((id: number) => subscriptionGroups.includes(id))
    data.user_group_ids = allGroupIds.filter((id: number) => internalGroups.includes(id))

    const formData = transformToFormData(data)

    // 小助理：从 API 获取技能列表（不从 settings.skills 获取）
    const agentType = formData.custom_config?.agent_type
    if (agentType === AGENT_TYPES.WORKBENCH) {
      const skills = await skillApi.getAgentBuiltinSkills(agentId)
      formData.settings = {
        ...formData.settings,
        skills: skills || [],
        initial_skills: skills || [],  // 保存原始列表，用于发布时对比差异
      }
    }

    return formData
  },

  async save(formData: AgentFormData): Promise<AgentFormData> {
    const saveData = transformToSaveData(formData)
    const result = await agentApi.save({ data: saveData })

    // 助理型平台（小助理/AI搜问）：保存模型配置
    const agentType = formData.custom_config?.agent_type
    if (agentType === AGENT_TYPES.WORKBENCH || agentType === AGENT_TYPES.KNOWLEDGE) {
      const agentId = result.agent_id
      if (agentId) {
        await saveModelsBatch(agentId, formData)
        // 小助理：保存技能配置
        if (agentType === AGENT_TYPES.WORKBENCH) {
          await saveSkillsBatch(agentId, formData)
        }
      }
    }

    return transformToFormData(result)
  },

  async getGroupOptions(): Promise<GroupOption[]> {
    const list = await groupApi.list({ params: { group_type: GROUP_TYPE.AGENT } })
    return (list || []).map((item: any) => ({
      value: +item.group_id || 0,
      label: item.group_name || '',
    }))
  },

  async delete(agentId: number): Promise<void> {
    await agentApi.delete({ data: { agent_id: agentId } })
  },

  async saveChannel(saveData: Record<string, any>): Promise<Record<string, any>> {
    const { channel_id, key, base_url, config, models, name, type } = saveData
    const payload = {
      key,
      base_url: base_url || '',
      name,
      models: Array.isArray(models) ? models.join(',') : models,
      config: JSON.stringify(config || {}),
      type: type || 1,
      priority: 0,
      weight: 0,
      other: '',
      model_mapping: '',
      custom_config: '',
      provider_id: 0,
    }
    let result
    if (channel_id) {
      result = await channelApi.update(channel_id, payload)
    } else {
      result = await channelApi.create(payload)
    }
    return result || {}
  },

  // ========== 平台配置 ==========

  getAgentConfig(platform: AgentType) {
    const config = getAgentByAgentType(platform)
    return {
      icon: config?.icon || '',
      name: config?.name || '',
      channelName: config?.channelName || '',
      channelType: config?.channelType || 0,
      mode: config?.mode || 'chat',
    }
  },

  async getPlatformConfig(params: { platform: AgentType; type?: string; provider_id?: number; agent_id?: string; workspace_id?: string; channel_id?: number; bot_id?: string | number; group_id?: number; keyword?: string; offset?: number; limit?: number }): Promise<any> {
    const { platform, type, provider_id, agent_id } = params

    if (type === 'providers') {
      const agentConfig = getAgentByAgentType(platform)
      const providerType = agentConfig?.providerId
      const list = await providersApi.list({ providerType })
      return { providers: transformProviderList(list || []) }
    }

    switch (platform) {
      case AGENT_TYPES.COZE_AGENT_CN:
      case AGENT_TYPES.COZE_WORKFLOW_CN: {
        if (type === 'bots') {
          const list = await agentApi.coze.bots_list(params.workspace_id || '', { provider_id })
          return { bots: (list || []).map(transformCozeBotItem) }
        }
        if (type === 'workspaces') {
          const ws = await agentApi.coze.workspaces_list({ provider_id })
          return { workspaces: (ws || []).map(transformCozeWorkspaceItem) }
        }
        // 默认返回 workspaces（向后兼容）
        const ws = await agentApi.coze.workspaces_list({ provider_id })
        return { workspaces: (ws || []).map(transformCozeWorkspaceItem) }
      }
      case AGENT_TYPES.APP_BUILDER: {
        const list = await agentApi.appbuilder.bots_list({ provider_id })
        return { bots: (list || []).map(transformAppBuilderBotItem) }
      }
      case AGENT_TYPES['53AI_AGENT']: {
        if (type === 'input_fields') {
          const res = await agentApi.chat53ai.workflow_field_list(agent_id || '', { provider_id })
          const fields = (res?.user_input_form || []).map((item: any) => Object.values(item)[0])
          return { input_fields: fields }
        }
        const list = await agentApi.chat53ai.bots_list({ provider_id })
        return { bots: (list || []).map(transform53aiBotItem) }
      }
      case AGENT_TYPES['53AI_WORKFLOW']: {
        if (type === 'input_fields') {
          const res = await agentApi.chat53ai.workflow_field_list(agent_id || '', { provider_id })
          const fields = (res?.user_input_form || []).map((item: any) => Object.values(item)[0])
          return { input_fields: fields }
        }
        const list = await agentApi.chat53ai.workflow_list({ provider_id })
        return { workflows: (list || []).map(transform53aiBotItem) }
      }
      case AGENT_TYPES.TENCENT: {
        const list = await agentApi.tencent.bots_list({ provider_id })
        return { bots: (list || []).map(transformTencentAppItem) }
      }
      case AGENT_TYPES.DIFY_WORKFLOW: {
        if (type === 'workflow_fields' && params.channel_id) {
          const res = await agentApi.dify.workflow_field_list(params.channel_id)
          return { user_input_form: res?.user_input_form || [] }
        }
        return null
      }
      default:
        return null
    }
  },

  // ========== UI 组件注入 ==========

  PageLayout: PageLayoutContent,

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

  PreviewComponent: AgentPreview as React.ComponentType<{
    ref?: any
  }>,

  InlinePreviewComponent: SharedChat as React.ComponentType<{
    className?: string
  }>,

  OpenClawPreviewComponent: ConsoleOpenClawEmbeddedChatWorkspace,

  UseScopeComponent: UseScope as React.ComponentType<{}>,

  SkillPickerComponent: SkillPicker as React.ComponentType<{
    value?: any[]
    onChange?: (skills: any[]) => void
    disabled?: boolean
    translate?: (key: string) => string
  }>,

  markdownEditorConfig: {
    cdn: `${lib_host}/js/vditor`,
    apiHost: api_host,
  },

  apiHost: api_host,

  // ========== 企业信息 ==========

  get isIndependent() { return useEnterpriseStore.getState().info.is_independent },
  get isIndustry() { return useEnterpriseStore.getState().info.is_industry },
  get isEnterprise() { return useEnterpriseStore.getState().info.is_enterprise },

  // 本地版（op-local）与私有化版（VITE_PRIVATE_PREM=true）隐藏知识图谱入口
  get hideKnowledgeGraph() { return isOpLocal || isPrivatePrem },

  // ========== 分组类型常量 ==========

  GROUP_TYPE: {
    USER: GROUP_TYPE.USER,
    INTERNAL_USER: GROUP_TYPE.INTERNAL_USER,
    AGENT: GROUP_TYPE.AGENT,
  },

  // ========== 分组选择组件 ==========

  GroupSelectComponent: GroupSelect as React.ComponentType<{
    value?: number | number[] | ScopeItem[]
    onChange?: (value: number | number[] | ScopeItem[]) => void
    type?: string
    groupType?: string
    multiple?: boolean
    defaultFirstValue?: boolean
    simpleValue?: boolean
    onOptionsLoad?: (options: any[]) => void
    children?: React.ReactNode
  }>,

  GroupTabsComponent: GroupTabs as React.ComponentType<{
    type?: string
    groupType?: string
    value?: string | number | (string | number)[]
    options?: any[]
    disabled?: boolean
    hideFooter?: boolean
    hidePrefix?: boolean
    className?: string
    onChange?: (value: string | number | (string | number)[]) => void
    onOptionsChange?: (options: any[]) => void
  }>,

  // ========== AGENT_TYPES 常量 ==========

  AGENT_TYPES,

  // ========== 会话/预览相关 API ==========

  createConversation: async (data) => {
    const conversationStore = useConversationStore.getState()
    const res = await conversationStore.save({ data })
    return { conversation_id: (res as any).data?.conversation_id || (res as any).conversation_id }
  },

  sendChatMessage: async (params) => {
    const conversationStore = useConversationStore.getState()
    await conversationStore.chat({
      data: {
        conversation_id: params.conversation_id,
        messages: params.messages,
        agent_id: params.agent_id,
        agent_configs: params.agent_configs,
        // 新增场景字段透传给 conversationStore.chat，让其按 minimal/full 拼 payload
        type: params.type,
        minimalParams: params.minimalParams,
        modelId: params.modelId,
        knowledgeSource: params.knowledgeSource,
        library: params.library,
        agentInfo: params.agentInfo,
      } as any,
      hideError: true,
      onDownloadProgress: params.onDownloadProgress,
      signal: params.signal,
    })
  },

  runWorkflow: async (data, options) => {
    return conversationApi.workflow.run(data, options)
  },

  uploadFile: async (file) => {
    const res = await uploadApi.upload(file)
    return {
      id: res.data.id,
      url: buildPreviewUrl(res.data.preview_key) ?? '',
      size: res.data.size,
      name: res.data.file_name,
      mime_type: res.data.mime_type,
    }
  },

  // ========== 模型列表 ==========

  loadModels: async () => {
    const list = await channelApi.listv2()
    const options: ChannelOption[] = []
    for (const item of list || []) {
      // 使用 transformSelectData 过滤模型，默认过滤推理模型
      const transformed = transformSelectData(item, MODEL_USE_TYPE.REASONING, undefined)
      if (transformed.options && transformed.options.length > 0) {
        options.push({
          value: `${item.channel_id}`,
          label: transformed.platform_name || transformed.name || '',
          icon: transformed.platform_icon || '',
          options: transformed.options.map((model: any) => ({
            value: model.value,
            model_value: model.model_value,
            label: model.label,
            icon: model.icon,
            vision: model.vision || false,
            deep_thinking: model.deep_thinking || false,
          })),
        })
      }
    }
    return options
  },

  loadRerankModels: async () => {
    const list = await channelApi.listv2()
    const options: ChannelOption[] = []
    for (const item of list || []) {
      // 使用 transformSelectData 过滤重排序模型
      const transformed = transformSelectData(item, MODEL_USE_TYPE.RERANKER, undefined)
      if (transformed.options && transformed.options.length > 0) {
        options.push({
          value: `${item.channel_id}`,
          label: transformed.platform_name || transformed.name || '',
          icon: transformed.platform_icon || '',
          options: transformed.options.map((model: any) => ({
            value: model.value,
            model_value: model.model_value,
            label: model.label,
            icon: model.icon,
            vision: model.vision || false,
            deep_thinking: model.deep_thinking || false,
          })),
        })
      }
    }
    return options
  },

  // ========== 智能体列表 ==========

  getAgentList: async (params) => {
    const result = await agentApi.list({
      params: {
        group_id: params.group_id,
        keyword: params.keyword,
        offset: params.offset,
        limit: params.limit,
      },
    })
    return {
      count: result.count || 0,
      agents: result.agents || [],
    }
  },

  getAgentModels: async (agentId) => {
    // preview 用：返回后端分配的 agent_models 列表（每条带独立 id），
    // useAgentPreviewSender 按 value 匹配后取 id 作为 modelId
    const res = await agentsApi.models.list(String(agentId))
    return res.agent_models || []
  },

  // ========== 消息气泡组件库 ==========

  BubbleComponents: {
    XBubbleList,
    XBubbleUser,
    XBubbleAssistant,
    XIcon,
    XSender,
  },

  // ========== 其他组件 ==========

  OtherComponents: {
    MarkdownEditor,
    PromptInput,
    SelectPlus,
    ModelSelectPopover,
  },

  // ========== 加载平台设置 ==========

  loadPlatformSettings: async () => {
    try {
      const result = await platformSettingsApi.find({
        platform_key: 'bochaai',
      })
      return (result || []).map(transformPlatformSetting)
    } catch (e) {
      console.error(e)
      return []
    }
  },

  // ========== Openclaw 密钥重置 ==========

  resetSecret: async (agentId: number) => {
    const data = await agentApi.resetSecret({ data: { agent_id: agentId } })
    return { secret: data.secret }
  },

  // ========== Agent 内置技能绑定 API ==========

  getAgentBuiltinSkills: async (agentId) => {
    const items = await skillApi.getAgentBuiltinSkills(agentId)
    return (items || []).map((item: any) => ({
      binding_id: item.binding_id,
      skill_id: item.skill_id,
      skill_library_id: item.skill_library_id,
      display_name: item.display_name,
      skill_name: item.skill_name,
      logo: item.logo,
      description: item.description,
    }))
  },

  addAgentBuiltinSkill: async (agentId, skillLibraryId) => {
    await skillApi.addAgentBuiltinSkill(agentId, skillLibraryId)
    // 添加后重新获取列表，返回新增的技能信息
    const items = await skillApi.getAgentBuiltinSkills(agentId)
    const newSkill = (items || []).find((item: any) => item.skill_library_id === skillLibraryId)
    return {
      binding_id: newSkill?.binding_id,
      skill_id: newSkill?.skill_id,
      skill_library_id: newSkill?.skill_library_id,
      display_name: newSkill?.display_name,
      skill_name: newSkill?.skill_name,
      logo: newSkill?.logo,
      description: newSkill?.description,
    }
  },

  deleteAgentBuiltinSkill: async (agentId, bindingId) => {
    await skillApi.deleteAgentBuiltinSkill(agentId, bindingId)
  },

  // ========== 复制到剪贴板 ==========

  copyToClip,
}

export default consoleAgentAdapter
