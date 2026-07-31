import { useCallback } from 'react'
import { useAgentFormStore } from '../store'
import type {
  AgentFormData,
  Settings,
  CustomConfig,
  FieldItem,
  RelateAgent,
  FileParseConfig,
  ImageParseConfig,
  SuggestedQuestion,
  UseAgentFormReturn,
} from '../types'

/**
 * Agent 表单状态管理 Hook
 *
 * 提供统一的表单状态访问和更新方法
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const form = useAgentForm()
 *
 *   // 读取状态
 *   console.log(form.formData.name)
 *
 *   // 更新字段
 *   form.updateField('name', 'New Name')
 *   form.updateFields({ name: 'Name', description: 'Desc' })
 * }
 * ```
 */
export function useAgentForm(): UseAgentFormReturn {
  const store = useAgentFormStore()

  // ========== 状态访问 ==========
  const formData = store.form_data
  const agentType = store.agent_type
  const agentId = store.agent_id
  const isNew = store.is_new
  const loading = store.loading
  const saving = store.saving
  const agentData = store.agent_data
  const groupOptions = store.group_options
  const supportImage = store.support_image

  // ========== 字段更新 ==========
  const updateField = useCallback(<K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => {
    store.updateField(key, value)
  }, [store])

  const updateFields = useCallback((updates: Partial<AgentFormData>) => {
    store.updateFields(updates)
  }, [store])

  // ========== Settings 更新 ==========
  const updateSettings = useCallback((updates: Partial<Settings>) => {
    store.updateSettings(updates)
  }, [store])

  const updateOpeningStatement = useCallback((statement: string) => {
    store.updateOpeningStatement(statement)
  }, [store])

  const updateSuggestedQuestions = useCallback((questions: SuggestedQuestion[]) => {
    store.updateSuggestedQuestions(questions)
  }, [store])

  const updateFileParse = useCallback((config: Partial<FileParseConfig>) => {
    store.updateFileParse(config)
  }, [store])

  const updateImageParse = useCallback((config: Partial<ImageParseConfig>) => {
    store.updateImageParse(config)
  }, [store])

  // ========== 字段管理 ==========
  const updateInputFields = useCallback((fields: FieldItem[]) => {
    store.updateInputFields(fields)
  }, [store])

  const updateOutputFields = useCallback((fields: FieldItem[]) => {
    store.updateOutputFields(fields)
  }, [store])

  // ========== 关联应用管理 ==========
  const updateRelateAgents = useCallback((agents: RelateAgent[]) => {
    store.updateRelateAgents(agents)
  }, [store])

  const addRelateAgent = useCallback((agent: RelateAgent) => {
    store.addRelateAgent(agent)
  }, [store])

  const removeRelateAgent = useCallback((agentId: string | number) => {
    store.removeRelateAgent(agentId)
  }, [store])

  const updateRelateAgent = useCallback((agentId: string | number, updates: Partial<RelateAgent>) => {
    store.updateRelateAgent(agentId, updates)
  }, [store])

  // ========== CustomConfig 更新 ==========
  const updateCustomConfig = useCallback((updates: Partial<CustomConfig>) => {
    store.updateCustomConfig(updates)
  }, [store])

  // ========== 基本信息更新 ==========
  const updateName = useCallback((name: string) => {
    store.updateField('name', name)
  }, [store])

  const updateLogo = useCallback((logo: string) => {
    store.updateField('logo', logo)
  }, [store])

  const updateDescription = useCallback((description: string) => {
    store.updateField('description', description)
  }, [store])

  const updateGroupId = useCallback((groupId: number) => {
    store.updateField('group_id', groupId)
  }, [store])

  const updateUseCases = useCallback((useCases: any[]) => {
    store.updateField('use_cases', useCases)
  }, [store])

  // ========== 其他方法 ==========
  const setSupportImage = useCallback((support: boolean) => {
    store.setSupportImage(support)
  }, [store])

  const getSupportFile = useCallback(() => {
    return store.getSupportFile()
  }, [store])

  return {
    // 状态访问
    formData,
    agentType,
    agentId,
    isNew,
    loading,
    saving,
    agentData,
    groupOptions,
    supportImage,

    // 字段更新
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

    // 其他方法
    setSupportImage,
    setAgentType: store.setAgentType,
    getSupportFile,
  }
}

/**
 * 创建表单验证函数
 * 用于 antd Form 的验证
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

export { usePlatformChannel } from './usePlatformChannel'
export type { UsePlatformChannelOptions, UsePlatformChannelReturn } from './usePlatformChannel'

export { default as ChannelConfigContext, useChannelConfig } from './useChannelConfig'
export type { ChannelConfig } from './useChannelConfig'

// 模型值工具
export { parseModelValue, encodeModelValue, isModelValueEmpty } from './useModelValue'
export type { ModelValueParts } from './useModelValue'

// 模型验证工具
export { validateModelConfig } from './useModelValidation'
export type { ModelConfig, ValidateModelOptions } from './useModelValidation'

// Preview sender capability hook (workbench skills + knowledge models)
export { useAgentPreviewSender, buildKnowledgeSourcePayload } from './useAgentPreviewSender'
export type {
  AgentPreviewSenderConfig,
  AgentPreviewModelOption,
  PreviewKnowledgeSourceState,
  KnowledgeSourceConfig,
} from './useAgentPreviewSender'

export default useAgentForm
