import { create } from 'zustand'
import { agentApi } from '@/api/modules/agent'
import { CHANNEL_TYPE_VALUE_MAP } from '@/constants/platform/channel'
import { groupApi } from '@/api/modules/group'
import { useEnterpriseStore } from '@/stores'
import { getAgentByAgentType, BACKEND_AGENT_TYPE, AGENT_MODES, AGENT_TYPES } from '@/constants/platform/config'
import type { AgentType } from '@/constants/platform/config'
import { GROUP_TYPE } from '@/constants/group'
import type { FormData, CustomConfig, Settings, AgentFormState, GroupOption } from './types'
import { getInitialFormData } from './types'

const enterpriseStore = useEnterpriseStore.getState

export const useAgentFormStore = create<AgentFormState>((set, get) => ({
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

  getAgentOptionData: () => {
    return getAgentByAgentType(get().agent_type as AgentType)
  },

  getSupportFile: () => {
    return get().agent_type !== AGENT_TYPES.PROMPT
  },

  getIsIndependent: () => {
    return enterpriseStore().info.is_independent
  },

  loadDetailData: async () => {
    const agentId = get().agent_id
    if (!agentId) return

    set({ loading: true })
    try {
      const agentData = await agentApi.detail({ data: { agent_id: agentId } })
      set({ agent_data: agentData })

      // 参考Vue toolbox版本：需要先加载分组列表，再从 user_group_ids 中过滤出对应的分组ID
      const enterprise = enterpriseStore().info
      const allGroupIds = agentData.user_group_ids || []

      // 并行加载注册用户分组和内部用户分组
      const [subscriptionGroups, internalGroups] = await Promise.all([
        (enterprise.is_independent || enterprise.is_industry)
          ? groupApi.list({ params: { group_type: GROUP_TYPE.USER } }).then(list => (list || []).map((item: any) => item.group_id))
          : Promise.resolve([]),
        (enterprise.is_enterprise || enterprise.is_industry)
          ? groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } }).then(list => (list || []).map((item: any) => item.group_id))
          : Promise.resolve([]),
      ])

      // 更新 agent_data 中的分组字段，供 updateFormData 使用
      agentData.subscription_group_ids = allGroupIds.filter((id: number) => subscriptionGroups.includes(id))
      agentData.user_group_ids = allGroupIds.filter((id: number) => internalGroups.includes(id))

      get().updateFormData()
    } finally {
      set({ loading: false })
    }
  },

  updateFormData: () => {
    const { agent_data, agent_type, getAgentOptionData } = get()
    const agentOptionData = getAgentOptionData()

    const newFormData: FormData = {
      logo: agent_data.logo || agentOptionData?.icon || '',
      name: agent_data.name || '',
      group_id: +agent_data.group_id || 0,
      description: agent_data.description || '',
      channel_type: +agent_data.channel_type || 0,
      model: agent_data.model || '',
      sort: +agent_data.sort || 0,
      prompt: agent_data.prompt || '',
      // 使用经过过滤的分组ID
      user_group_ids: agent_data.user_group_ids || [],
      subscription_group_ids: agent_data.subscription_group_ids || [],
      tools: agent_data.tools || [],
      use_cases: agent_data.use_cases || [],
      configs:
        agent_data.configs && Object.keys(agent_data.configs).length > 0
          ? agent_data.configs
          : { completion_params: { temperature: 0.2, top_p: 0.75, presence_penalty: 0.5, frequency_penalty: 0.5 } },
      enable: !!+agent_data.enable || false,
      custom_config: {
        agent_type: agent_type,
        provider_id: 0,
        channel_id: 0,
        coze_workspace_id: '',
        coze_bot_id: '',
        coze_bot_url: '',
        tencent_bot_id: '',
        app_builder_bot_id: '',
        chat53ai_agent_id: '',
        channel_config: {},
        ...(agent_data.custom_config || {}),
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
        ...(agent_data.settings || {}),
      },
    }

    const customConfig = agent_data.custom_config || {}

    if (agent_type === AGENT_TYPES.PROMPT) {
      newFormData.model =
        `${customConfig.channel_id}_53aikm_${agent_data.model}_53aikm_${agent_data.channel_type}` || ''
    }

    // Migrate file_parse to settings
    if (customConfig.file_parse) {
      newFormData.settings.file_parse = customConfig.file_parse
      newFormData.settings.image_parse = customConfig.image_parse
      delete customConfig.file_parse
      delete customConfig.image_parse
    }

    let supportImage = false
    if (newFormData.settings.image_parse.vision) {
      supportImage = true
    }
    if (agent_type !== AGENT_TYPES.PROMPT) {
      supportImage = true
    }

    // 从 custom_config.agent_type 获取前端类型，而不是从 agent_data.agent_type（后端类型 0/1）
    const frontendAgentType = (agent_data.custom_config?.agent_type as string) || agent_type || ''
    set({
      agent_type: frontendAgentType,
      form_data: newFormData,
      support_image: supportImage,
    })
  },

  loadGroupOptions: async () => {
    const list = await groupApi.list({ params: { group_type: GROUP_TYPE.AGENT } })
    const groupOptions = (list || []).map((item: any) => ({
      value: +item.group_id || 0,
      label: item.group_name || '',
      group_id: +item.group_id || 0,
      group_name: item.group_name || '',
    }))

    const { form_data } = get()
    if (groupOptions.length && !form_data.group_id) {
      form_data.group_id = groupOptions[0].value
    }
    if (!groupOptions.find((item: any) => item.value === form_data.group_id)) {
      form_data.group_id = 0
    }

    set({ group_options: groupOptions, form_data: { ...form_data } })
  },

  resetState: () => {
    set({
      saving: false,
      loading: false,
      initializing: false,
      agent_id: 0,
      agent_type: 'prompt',
      is_new: false,
      form_data: getInitialFormData(),
      agent_data: {},
      group_options: [],
      support_image: false,
    })
  },

  saveAgentData: async ({ hideToast = false } = {}) => {
    const { form_data, agent_id, agent_type } = get()

    const {
      logo = '',
      name = '',
      group_id = 0,
      description = '',
      model = '',
      channel_type = 0,
      prompt = '',
      user_group_ids = [],
      subscription_group_ids = [],
      use_cases = [],
      tools = [],
      sort = 0,
      configs = {},
      enable,
      custom_config = {},
      settings = {},
    } = form_data

    const data: any = {
      agent_id: agent_id || 0,
      agent_type: BACKEND_AGENT_TYPE.AGENT,
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
      enable,
      custom_config,
      settings,
    }

    const agentConfig = getAgentByAgentType(agent_type as AgentType)

    if (!channel_type) {
      data.channel_type = CHANNEL_TYPE_VALUE_MAP.get(agent_type) || 0
    }
    switch (agent_type) {
      case AGENT_TYPES.PROMPT:
        data.custom_config.channel_id = +model.split('_53aikm_')[0] || 0
        data.model = model.split('_53aikm_')[1] || ''
        data.channel_type = +model.split('_53aikm_')[2] || 0
        break
      case AGENT_TYPES.COZE_AGENT_CN:
        data.model = custom_config.coze_bot_id || ''
        break
      case AGENT_TYPES.COZE_WORKFLOW_CN:
        const params = new URLSearchParams(custom_config.coze_bot_url.split('?')[1])
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

    if (agentConfig && agentConfig.mode === AGENT_MODES.COMPLETION) {
      data.agent_type = BACKEND_AGENT_TYPE.WORKFLOW
    }

    data.custom_config.agent_type = agent_type
    data.custom_config.agent_mode = getAgentByAgentType(agent_type as AgentType).mode || 'chat'

    set({ saving: true })
    const resultData = await agentApi.save({ data }).finally(() => {
      set({ saving: false })
    })

    if (!hideToast) {
      const { message } = await import('antd')
      message.success(window.$t('action_save_success'))
    }

    set({ agent_data: resultData, agent_id: resultData.agent_id })
    return resultData
  },

  // 新增：统一状态更新方法
  updateSettings: (updates: Partial<Settings>) => {
    set(state => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          ...updates,
        },
      },
    }))
  },

  updateCustomConfig: (updates: Partial<CustomConfig>) => {
    set(state => ({
      form_data: {
        ...state.form_data,
        custom_config: {
          ...state.form_data.custom_config,
          ...updates,
        },
      },
    }))
  },

  updateInputFields: (fields: any[]) => {
    set(state => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          input_fields: fields,
        },
      },
    }))
  },

  updateOutputFields: (fields: any[]) => {
    set(state => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          output_fields: fields,
        },
      },
    }))
  },

  updateRelateAgents: (agents: any[]) => {
    set(state => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          relate_agents: agents,
        },
      },
    }))
  },
}))

export default useAgentFormStore
