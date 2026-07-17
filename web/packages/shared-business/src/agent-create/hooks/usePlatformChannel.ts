import { useState, useEffect, useRef, useCallback } from 'react'
import type { FormInstance } from 'antd'
import { Form } from 'antd'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { useAgentForm } from './index'
import { useChannelConfig } from './useChannelConfig'
import type { ChannelConfigData, ChannelFormState } from '../types'

export interface UsePlatformChannelOptions {
  /** 平台名称（用于保存时识别） */
  platformName: string
  /** 默认 base URL */
  defaultBaseUrl?: string
  /** 是否需要生成 model（如 MaxKB） */
  generateModel?: (values: any) => string
}

export interface UsePlatformChannelReturn {
  /** 渠道配置对象 */
  channelConfig: Record<string, any>
  /** 渠道表单实例 */
  channelForm: FormInstance
  /** 是否已编辑 */
  channelEditable: boolean
  /** 设置是否已编辑 */
  setChannelEditable: (editable: boolean) => void
  /** 渠道表单状态 ref */
  channelFormState: React.MutableRefObject<ChannelFormState>
  /** Agent 表单实例 */
  agentForm: FormInstance
  /** 保存渠道配置 */
  onChannelSave: () => Promise<void>
  /** 验证表单 */
  validateForm: (showChannelConfig?: boolean) => Promise<boolean>
  /** 同步 agentData 到渠道配置 */
  syncChannelConfig: (agentData: Record<string, any>) => void
  /** 翻译函数 */
  t: (key: string, params?: Record<string, any>) => string
  /** formData 快捷访问 */
  formData: ReturnType<typeof useAgentForm>['formData']
  /** 适配器实例 */
  adapter: ReturnType<typeof useAgentCreateAdapter>
}

/**
 * 平台渠道配置 Hook
 *
 * 封装平台组件的共享逻辑：
 * - channel_config 数据同步
 * - 渠道保存
 * - 表单验证
 */
export function usePlatformChannel(options: UsePlatformChannelOptions): UsePlatformChannelReturn {
  const { platformName, defaultBaseUrl = '', generateModel } = options

  const channelConfig = useChannelConfig() as Record<string, any>
  const [channelForm] = Form.useForm()
  const [channelEditable, setChannelEditable] = useState(false)
  const [agentForm] = Form.useForm()
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)

  const { agentData, formData } = useAgentForm()

  const channelFormState = useRef<ChannelFormState>({
    key: '',
    base_url: defaultBaseUrl,
    models: [],
    model: '',
    config: {
      agent_type: 'chat',
    },
  })

  // 同步 channel_config 数据
  const syncChannelConfig = useCallback((data: Record<string, any>) => {
    // 检查 store 的 agent_id
    const storeAgentId = useAgentFormStore.getState().agent_id

    // 新建模式：设置默认值，不同步旧数据
    if (!storeAgentId) {
      setChannelEditable(false)
      channelConfig.channel_id = 0
      channelConfig.key = channelFormState.current.key = ''
      channelConfig.base_url = channelFormState.current.base_url = defaultBaseUrl
      channelConfig.models = channelFormState.current.models = []
      channelConfig.model = channelFormState.current.model = ''
      channelConfig.config = channelFormState.current.config = { agent_type: 'chat' }

      // 回填表单默认值
      channelForm.setFieldsValue({
        key: '',
        base_url: defaultBaseUrl,
        model: '',
        config: { agent_type: 'chat' },
      })
      return
    }

    // 编辑模式：检查数据是否匹配当前 agent
    const dataAgentId = data?.agent_id
    if (dataAgentId !== storeAgentId) {
      return
    }

    // channel_config 在 custom_config 中（适配器返回的 AgentFormData 格式）
    // 或在顶层（原版 create 的原始 API 响应格式）
    const channel_config: ChannelConfigData = data?.custom_config?.channel_config || data?.channel_config || {}
    const channelId = Number(channel_config.channel_id || 0)
    setChannelEditable(channelId > 0)
    channelConfig.channel_id = channelId
    channelConfig.key = channelFormState.current.key = channel_config.key || ''
    channelConfig.base_url = channelFormState.current.base_url = channel_config.base_url || defaultBaseUrl
    channelConfig.models = channelFormState.current.models = channel_config.models || []
    channelConfig.model = channelFormState.current.model = channel_config.models?.[0] || ''
    channelConfig.config = channelFormState.current.config = {
      ...(channel_config.config || {}),
      agent_type: channel_config.config?.agent_type || 'chat',
    }
    // 回填表单
    channelForm.setFieldsValue({
      key: channelFormState.current.key,
      base_url: channelFormState.current.base_url,
      model: channelFormState.current.model,
      config: {
        agent_type: channelFormState.current.config.agent_type,
      },
    })
  }, [channelConfig, channelForm, defaultBaseUrl])

  // 监听 agentData 变化
  useEffect(() => {
    if (agentData) {
      syncChannelConfig(agentData)
    }
  }, [agentData, syncChannelConfig])

  // 保存渠道配置
  const onChannelSave = useCallback(async () => {
    try {
      const values = channelForm.getFieldsValue()
      // 更新状态
      channelFormState.current.key = values.key
      // base_url: 如果表单没有该字段，使用默认值
      channelFormState.current.base_url = values.base_url || channelFormState.current.base_url || defaultBaseUrl
      channelFormState.current.config.agent_type = values.config?.agent_type || 'chat'

      // 获取或生成 model
      let model: string
      if (generateModel) {
        // 有 generateModel 时，总是用它生成 model
        model = generateModel(values)
      } else {
        model = values.model || channelFormState.current.model
      }
      channelFormState.current.model = model

      const models = [channelFormState.current.model]
      const store = useAgentFormStore.getState()
      const agentConfig = adapter.getAgentConfig?.(store.agent_type)
      const channelType = agentConfig?.channelType || 0

      const saveData = {
        channel_id: channelConfig.channel_id,
        key: channelFormState.current.key,
        base_url: channelFormState.current.base_url,
        config: channelFormState.current.config,
        models,
        name: platformName,
        type: channelType,
      }

      const resultData = await adapter.saveChannel?.(saveData)

      Object.assign(channelConfig, resultData.data)
      if (!saveData.channel_id) saveData.channel_id = resultData.data.channel_id

      useAgentFormStore.setState({
        form_data: {
          ...store.form_data,
          channel_type: agentConfig?.channelType || store.form_data.channel_type,
          model: models[0],
          custom_config: {
            ...store.form_data.custom_config,
            channel_config: saveData,
          },
        },
      })
      setChannelEditable(true)
    } catch (error) {
      console.error('Channel save error:', error)
    }
  }, [adapter, channelConfig, channelForm, defaultBaseUrl, generateModel, platformName])

  // 验证表单
  const validateForm = useCallback(async (showChannelConfig?: boolean) => {
    try {
      if (showChannelConfig) {
        await channelForm.validateFields()
      }
      await agentForm.validateFields()
      return true
    } catch {
      return false
    }
  }, [channelForm, agentForm])

  return {
    channelConfig,
    channelForm,
    channelEditable,
    setChannelEditable,
    channelFormState,
    agentForm,
    onChannelSave,
    validateForm,
    syncChannelConfig,
    t,
    formData,
    adapter,
  }
}

export default usePlatformChannel
