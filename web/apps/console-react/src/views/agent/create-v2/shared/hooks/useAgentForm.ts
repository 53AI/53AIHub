/**
 * Agent 表单操作 Hook
 * 封装 Zustand store 操作，提供统一的状态管理接口
 */

import { useCallback } from 'react'
import { useAgentFormStore } from '../store'
import type { FormData, Settings, CustomConfig, FieldItem, RelateAgent, SuggestedQuestion } from '../types'
import type { AgentType } from '@/constants/platform/config'

/**
 * 表单操作 Hook
 * 提供统一的状态访问和更新方法
 */
export function useAgentForm() {
  // ===== 状态访问（每个 selector 独立订阅，避免不必要的重渲染）=====
  const formData = useAgentFormStore((state) => state.form_data)
  const agentType = useAgentFormStore((state) => state.agent_type)
  const agentId = useAgentFormStore((state) => state.agent_id)
  const isNew = useAgentFormStore((state) => state.is_new)
  const loading = useAgentFormStore((state) => state.loading)
  const saving = useAgentFormStore((state) => state.saving)
  const agentData = useAgentFormStore((state) => state.agent_data)
  const groupOptions = useAgentFormStore((state) => state.group_options)
  const supportImage = useAgentFormStore((state) => state.support_image)

  // ===== 表单字段更新 =====

  /**
   * 更新表单单个字段
   */
  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        [field]: value,
      },
    }))
  }, [])

  /**
   * 批量更新表单字段
   */
  const updateFields = useCallback((updates: Partial<FormData>) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        ...updates,
      },
    }))
  }, [])

  // ===== Settings 更新 =====

  /**
   * 更新 Settings
   */
  const updateSettings = useCallback((updates: Partial<Settings>) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          ...updates,
        },
      },
    }))
  }, [])

  /**
   * 更新开场白
   */
  const updateOpeningStatement = useCallback((value: string) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          opening_statement: value,
        },
      },
    }))
  }, [])

  /**
   * 更新建议问题
   */
  const updateSuggestedQuestions = useCallback((questions: SuggestedQuestion[]) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          suggested_questions: questions,
        },
      },
    }))
  }, [])

  /**
   * 更新文件解析配置
   */
  const updateFileParse = useCallback((enable: boolean) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          file_parse: {
            ...state.form_data.settings.file_parse,
            enable,
          },
        },
      },
    }))
  }, [])

  /**
   * 更新图片解析配置
   */
  const updateImageParse = useCallback((enable: boolean) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          image_parse: {
            ...state.form_data.settings.image_parse,
            enable,
          },
        },
      },
    }))
  }, [])

  // ===== 字段管理 =====

  /**
   * 更新输入字段
   */
  const updateInputFields = useCallback((fields: FieldItem[]) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
 ...state.form_data,
        settings: {
          ...state.form_data.settings,
          input_fields: fields,
        },
      },
    }))
  }, [])

  /**
   * 更新输出字段
   */
  const updateOutputFields = useCallback((fields: FieldItem[]) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          output_fields: fields,
        },
      },
    }))
  }, [])

  // ===== 关联应用管理 =====

  /**
   * 更新关联应用
   */
  const updateRelateAgents = useCallback((agents: RelateAgent[]) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          relate_agents: agents,
        },
      },
    }))
  }, [])

  /**
   * 添加关联应用
   */
  const addRelateAgent = useCallback((agent: RelateAgent) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          relate_agents: [...state.form_data.settings.relate_agents, agent],
        },
      },
    }))
  }, [])

  /**
   * 移除关联应用
   */
  const removeRelateAgent = useCallback((agentId: number) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        settings: {
          ...state.form_data.settings,
          relate_agents: state.form_data.settings.relate_agents.filter(
            (item) => item.agent_id !== agentId
          ),
        },
      },
    }))
  }, [])

  /**
   * 更新关联应用配置
   */
  const updateRelateAgent = useCallback((agent: RelateAgent) => {
    useAgentFormStore.setState((state) => {
      const agents = [...state.form_data.settings.relate_agents]
      const index = agents.findIndex((item) => item.agent_id === agent.agent_id)
      if (index !== -1) {
        agents[index] = agent
      }
      return {
        form_data: {
          ...state.form_data,
          settings: {
            ...state.form_data.settings,
            relate_agents: agents,
          },
        },
      }
    })
  }, [])

  // ===== CustomConfig 更新 =====

  /**
   * 更新 CustomConfig
   */
  const updateCustomConfig = useCallback((updates: Partial<CustomConfig>) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        custom_config: {
          ...state.form_data.custom_config,
          ...updates,
        },
      },
    }))
  }, [])

  // ===== 基本信息更新 =====

  /**
   * 更新名称
   */
  const updateName = useCallback((name: string) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        name,
      },
    }))
  }, [])

  /**
   * 更新 Logo
   */
  const updateLogo = useCallback((logo: string) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        logo,
      },
    }))
  }, [])

  /**
   * 更新描述
   */
  const updateDescription = useCallback((description: string) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        description,
      },
    }))
  }, [])

  /**
   * 更新分组
   */
  const updateGroupId = useCallback((groupId: number) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        group_id: groupId,
      },
    }))
  }, [])

  /**
   * 更新用例场景
   */
  const updateUseCases = useCallback((useCases: FormData['use_cases']) => {
    useAgentFormStore.setState((state) => ({
      form_data: {
        ...state.form_data,
        use_cases: useCases,
      },
    }))
  }, [])

  // ===== Store 操作 =====

  /**
   * 保存 Agent 数据
   */
  const save = useCallback((options?: { hideToast?: boolean }) => {
    return useAgentFormStore.getState().saveAgentData(options)
  }, [])

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    useAgentFormStore.getState().resetState()
  }, [])

  /**
   * 加载详情数据
   */
  const loadDetail = useCallback(() => {
    return useAgentFormStore.getState().loadDetailData()
  }, [])

  /**
   * 加载分组选项
   */
  const loadGroups = useCallback(() => {
    return useAgentFormStore.getState().loadGroupOptions()
  }, [])

  /**
   * 设置 Agent 类型
   */
  const setAgentType = useCallback((type: string) => {
    useAgentFormStore.setState({ agent_type: type })
  }, [])

  /**
   * 设置 Agent 类型和 ID
   */
  const setAgentInfo = useCallback((type: AgentType, id: number) => {
    useAgentFormStore.setState({
      agent_type: type,
      agent_id: id,
    })
  }, [])

  /**
   * 设置新建状态
   */
  const setIsNew = useCallback((isNew: boolean) => {
    useAgentFormStore.setState({ is_new: isNew })
  }, [])

  /**
   * 设置支持图片状态
   */
  const setSupportImage = useCallback((value: boolean) => {
    useAgentFormStore.setState({ support_image: value })
  }, [])

  return {
    // 状态
    formData,
    agentType,
    agentId,
    isNew,
    loading,
    saving,
    agentData,
    groupOptions,
    supportImage,

    // 获取方法
    getAgentOptionData: () => useAgentFormStore.getState().getAgentOptionData(),
    getSupportFile: () => useAgentFormStore.getState().getSupportFile(),
    getIsIndependent: () => useAgentFormStore.getState().getIsIndependent(),

    // 表单字段更新
    updateField,
    updateFields,

    // Settings 更新
    updateSettings,
    updateOpeningStatement,
    updateSuggestedQuestions,
    updateFileParse,
    updateImageParse,

    // 字段管理
    updateInputFields,
    updateOutputFields,

    // 关联应用管理
    updateRelateAgents,
    addRelateAgent,
    removeRelateAgent,
    updateRelateAgent,

   // CustomConfig 更新
    updateCustomConfig,

    // 基本信息更新
    updateName,
    updateLogo,
    updateDescription,
    updateGroupId,
    updateUseCases,

    // Store 操作
    save,
    reset,
    loadDetail,
    loadGroups,
    setAgentType,
    setAgentInfo,
    setIsNew,
    setSupportImage,
  }
}

/**
 * 创建表单验证函数
 */
export function createValidateForm(form: any) {
  return async () => {
    try {
      if (form) {
        await form.validateFields()
      }
      return true
    } catch {
      return false
    }
  }
}

export default useAgentForm