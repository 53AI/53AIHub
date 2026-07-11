import { forwardRef, useImperativeHandle, useRef, useCallback, useState } from 'react'
import { useAgentFormStore } from '../../store'
import { useAgentCreateAdapter } from '../../adapters'
import { useChannelConfig } from '../../hooks/useChannelConfig'
import { getInitialFormData } from '../../types'

interface ChannelConfig {
  channel_type?: number
  name?: string
  label?: string
  value?: string
}

interface OpenParams {
  agent_type?: string
  data?: {
    channel_config?: ChannelConfig
    label?: string
    value?: string
  }
  agent_id?: string | number
  group_id?: number
  cache?: boolean
}

export interface AgentDrawerRef {
  open: (params?: OpenParams) => void
  close: () => void
  handleSave: () => Promise<void>
}

export const AgentDrawer = forwardRef<AgentDrawerRef, {
  onSuccess?: (data: any) => void
  onCancel?: () => void
  className?: string
}>(({ onSuccess, onCancel, className }, ref) => {
  const channelConfig = useChannelConfig()
  const adapter = useAgentCreateAdapter()
  const agentFormRef = useRef<any>(null)
  // 用于强制重新挂载 AgentFormComponent
  const [instanceKey, setInstanceKey] = useState(0)

  // 直接从 store 读取状态，单一数据源
  const agentType = useAgentFormStore((state) => state.agent_type)

  const open = useCallback(async ({ agent_type, data = {}, agent_id, group_id = 0, cache = false }: OpenParams = {}) => {
    const currentAgentType = agent_type || adapter.defaultPlatform
    const numericAgentId = agent_id ? +agent_id : 0
    const isNewAgent = !numericAgentId

    // 更新 channel config
    Object.keys(channelConfig).forEach((key) => delete channelConfig[key])

    Object.assign(channelConfig, data.channel_config || {})
    channelConfig.name = channelConfig.name || data.label || ''
    if (!channelConfig.channel_type && data.value) {
      channelConfig.channel_type = +data.value || 0
    }

    if (cache) {
      // cache 模式下不重置状态，只更新 editable 标记
      useAgentFormStore.setState({ is_new: !numericAgentId })
    } else {
      // 获取平台配置
      const agentConfig = adapter.getAgentConfig?.(currentAgentType) || {}

      // 重置并初始化状态
      const store = useAgentFormStore.getState()

      // 新建模式：使用全新初始状态，只保留弹框传入的 logo
      // 编辑模式：保留现有数据
      const baseFormData = isNewAgent ? getInitialFormData() : store.form_data
      const logo = isNewAgent
        ? store.form_data.logo // 保留弹框传入的 logo
        : (agentConfig.icon || store.form_data.logo || '')

      useAgentFormStore.setState({
        agent_type: currentAgentType,
        agent_id: numericAgentId,
        is_new: isNewAgent,
        agent_data: isNewAgent ? {} : store.agent_data,
        form_data: {
          ...baseFormData,
          logo,
          channel_type: agentConfig.channelType || 0,
          group_id: group_id || (isNewAgent ? 0 : store.form_data.group_id) || 0,
          custom_config: {
            ...baseFormData.custom_config,
            agent_type: currentAgentType,
          },
        },
      })

      // 强制重新挂载组件（新建时生成新 key）
      if (isNewAgent) {
        setInstanceKey(k => k + 1)
      }

      // 加载详情
      if (numericAgentId) {
        await useAgentFormStore.getState().loadDetailData()
      }

      // 加载分组选项
      useAgentFormStore.getState().loadGroupOptions()
    }
  }, [channelConfig, adapter])

  const close = useCallback(() => {
    onCancel?.()
  }, [onCancel])

  const handleSave = useCallback(async () => {
    const compRef = agentFormRef.current
    if (compRef && compRef.validateForm) {
      const valid = await compRef.validateForm()
      if (!valid) return Promise.reject()

      await compRef.onChannelSave?.()

      const store = useAgentFormStore.getState()
      if (store.is_new) {
        await store.saveAgentData({ hideToast: true })
      }

      onSuccess?.({
        agent_id: store.agent_id,
        agent_type: store.agent_type,
        action: store.is_new ? 'create' : 'update',
      })
    }
  }, [onSuccess])

  useImperativeHandle(ref, () => ({
    open,
    close,
    handleSave,
  }))

  // 使用适配器注入的 AgentForm 组件
  const AgentFormComponent = adapter.AgentFormComponent

  if (!AgentFormComponent) {
    return null
  }

  return (
    <AgentFormComponent
      key={`${agentType}-${instanceKey}`}
      ref={agentFormRef}
      agentType={agentType}
      showChannelConfig
      className={className}
    />
  )
})

AgentDrawer.displayName = 'AgentDrawer'

export default AgentDrawer
