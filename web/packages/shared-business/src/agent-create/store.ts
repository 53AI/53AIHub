import { create } from 'zustand'
import type {
  AgentFormData,
  Settings,
  CustomConfig,
  GroupOption,
  FieldItem,
  RelateAgent,
  FileParseConfig,
  ImageParseConfig,
  SuggestedQuestion,
  IAgentCreateAdapter,
} from './types'
import { getInitialFormData, getInitialState } from './types'
import { AGENT_TYPES } from './constants'

// ==================== Store 状态接口 ====================

interface AgentFormStoreState {
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
  adapter: IAgentCreateAdapter | null
  // 修改追踪：保存初始表单数据用于比较
  initial_form_data: AgentFormData | null
  // 是否有未保存的修改
  is_dirty: boolean
}

// ==================== Store 操作接口 ====================

interface AgentFormStoreActions {
  // 基础状态更新
  setSaving: (saving: boolean) => void
  setLoading: (loading: boolean) => void
  setInitializing: (initializing: boolean) => void
  setAgentId: (id: number | string) => void
  setAgentType: (type: string) => void
  setFormData: (data: Partial<AgentFormData>) => void
  setAgentData: (data: Record<string, any>) => void
  setGroupOptions: (options: GroupOption[]) => void
  setSupportImage: (support: boolean) => void
  setIsNew: (isNew: boolean) => void
  setAdapter: (adapter: IAgentCreateAdapter) => void

  // 重置
  reset: () => void

  // 表单字段更新
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

  // 适配器驱动的 API 方法
  loadDetailData: () => Promise<void>
  saveAgentData: (options?: { hideToast?: boolean }) => Promise<AgentFormData | void>
  loadGroupOptions: () => Promise<void>

  // 辅助方法
  getSupportFile: () => boolean

  // 修改追踪
  setInitialFormData: (data: AgentFormData) => void
  setIsDirty: (dirty: boolean) => void
  checkDirty: () => boolean
  resetDirty: () => void
}

type AgentFormStore = AgentFormStoreState & AgentFormStoreActions

// ==================== Store 实现 ====================

export const useAgentFormStore = create<AgentFormStore>((set, get) => ({
  // 初始状态
  ...getInitialState(),
  adapter: null,
  initial_form_data: null,
  is_dirty: false,

  // 基础状态更新
  setSaving: (saving) => set({ saving }),
  setLoading: (loading) => set({ loading }),
  setInitializing: (initializing) => set({ initializing }),
  setAgentId: (agent_id: string | number) => set({ agent_id }),
  setAgentType: (agent_type) => set({ agent_type }),
  setFormData: (data) => set((state) => ({
    form_data: { ...state.form_data, ...data },
  })),
  setAgentData: (agent_data) => set({ agent_data }),
  setGroupOptions: (group_options) => set({ group_options }),
  setSupportImage: (support_image) => set({ support_image }),
  setIsNew: (is_new) => set({ is_new }),
  setAdapter: (adapter) => set({ adapter }),

  // 重置
  reset: () => set({
    ...getInitialState(),
    adapter: get().adapter, // 保留 adapter
  }),

  // 表单字段更新
  updateField: (key, value) => set((state) => ({
    form_data: { ...state.form_data, [key]: value },
  })),
  updateFields: (updates) => set((state) => ({
    form_data: { ...state.form_data, ...updates },
  })),

  // Settings 更新
  updateSettings: (updates) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, ...updates },
    },
  })),
  updateOpeningStatement: (opening_statement) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, opening_statement },
    },
  })),
  updateSuggestedQuestions: (suggested_questions) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, suggested_questions },
    },
  })),
  updateFileParse: (config) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: {
        ...state.form_data.settings,
        file_parse: { ...state.form_data.settings.file_parse, ...config },
      },
    },
  })),
  updateImageParse: (config) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: {
        ...state.form_data.settings,
        image_parse: { ...state.form_data.settings.image_parse, ...config },
      },
    },
  })),

  // 字段管理
  updateInputFields: (input_fields) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, input_fields },
    },
  })),
  updateOutputFields: (output_fields) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, output_fields },
    },
  })),

  // 关联应用管理
  updateRelateAgents: (relate_agents) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: { ...state.form_data.settings, relate_agents },
    },
  })),
  addRelateAgent: (agent) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: {
        ...state.form_data.settings,
        relate_agents: [...state.form_data.settings.relate_agents, agent],
      },
    },
  })),
  removeRelateAgent: (agentId) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: {
        ...state.form_data.settings,
        relate_agents: state.form_data.settings.relate_agents.filter(
          (a) => a.agent_id !== agentId
        ),
      },
    },
  })),
  updateRelateAgent: (agentId, updates) => set((state) => ({
    form_data: {
      ...state.form_data,
      settings: {
        ...state.form_data.settings,
        relate_agents: state.form_data.settings.relate_agents.map((a) =>
          a.agent_id === agentId ? { ...a, ...updates } : a
        ),
      },
    },
  })),

  // CustomConfig 更新
  updateCustomConfig: (updates) => set((state) => ({
    form_data: {
      ...state.form_data,
      custom_config: { ...state.form_data.custom_config, ...updates },
    },
  })),

  // 适配器驱动的 API 方法
  loadDetailData: async () => {
    const { adapter, agent_id } = get()
    if (!adapter || !agent_id) return

    set({ loading: true })
    try {
      let data = await adapter.getDetail(agent_id)
      // 应用适配器的数据过滤

      if (adapter.filterResponseData) {
        data = adapter.filterResponseData(data)
      }

      const agent_type = data.custom_config?.agent_type || AGENT_TYPES.PROMPT

      // 根据 API 返回数据或 agent_type 判断是否支持图片解析
      let supportImage = false
      if (data.settings?.image_parse?.vision) {
        supportImage = true
      }
      if (agent_type !== AGENT_TYPES.PROMPT) {
        supportImage = true
      }
      
      set({
        agent_data: data,
        form_data: { ...getInitialFormData(), ...data },
        agent_type,
        support_image: supportImage,
      })

      // 通知适配器数据已加载（如需同步到本地 store）
      adapter.onDetailLoaded?.(data)
    } finally {
      set({ loading: false })
    }
  },

  saveAgentData: async (options = {}) => {
    const { adapter, form_data, agent_id } = get()
    if (!adapter) return

    let dataToSave = form_data

    // 应用适配器的数据过滤
    if (adapter.filterFormData) {
      dataToSave = adapter.filterFormData(form_data)
    }

    set({ saving: true })
    try {
      const result = await adapter.save({
        ...dataToSave,
        agent_id: agent_id || undefined,
      })

      set({
        agent_data: result,
        agent_id: result.agent_id,
      })

      if (!options.hideToast) {
        const { message } = await import('antd')
        const t = (window as any).$t
        message.success(t?.('action_save_success') || 'Saved')
      }

      return result
    } finally {
      set({ saving: false })
    }
  },

  loadGroupOptions: async () => {
    const { adapter } = get()
    if (!adapter?.getGroupOptions) return

    const options = await adapter.getGroupOptions()

    // 使用函数式更新获取最新的 form_data
    set((state) => {
      // 新建模式默认选中第一个分组（如果当前没有选中）
      if (options.length > 0 && !state.form_data.group_id) {
        return {
          group_options: options,
          form_data: { ...state.form_data, group_id: options[0].value }
        }
      }
      return { group_options: options }
    })
  },

  getSupportFile: () => {
    return get().agent_type !== 'prompt'
  },

  // 修改追踪
  setInitialFormData: (data) => set({
    initial_form_data: JSON.parse(JSON.stringify(data)),
    is_dirty: false,
  }),

  setIsDirty: (dirty) => set({ is_dirty: dirty }),

  checkDirty: () => {
    const { initial_form_data, form_data } = get()
    if (!initial_form_data) return false
    // 深度比较两个对象
    return JSON.stringify(initial_form_data) !== JSON.stringify(form_data)
  },

  resetDirty: () => set({
    initial_form_data: null,
    is_dirty: false,
  }),
}))

export default useAgentFormStore
