import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react'
import { useAgentFormStore } from '../../store'
import { AgentForm } from '../../platform'
import { AGENT_TYPES, getAgentByAgentType } from '@/constants/platform/config'
import type { AgentType } from '@/constants/platform/config'
import { useChannelConfig } from '../../context/ChannelConfigContext'

interface ChannelConfig {
  channel_type?: number
  name?: string
  label?: string
  value?: string
}

interface OpenParams {
  agent_type?: AgentType
  data?: {
    channel_config?: ChannelConfig
    label?: string
    value?: string
  }
  agent_id?: number
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
  const agentFormRef = useRef<any>(null)

  // 直接从 store 读取状态，单一数据源
  const agentType = useAgentFormStore((state) => state.agent_type)
  const agentId = useAgentFormStore((state) => state.agent_id)
  const isNew = useAgentFormStore((state) => state.is_new)

  const open = useCallback(async ({ agent_type, data = {}, agent_id, group_id = 0, cache = false }: OpenParams = {}) => {
    const currentAgentType = agent_type || AGENT_TYPES.PROMPT

    // 更新 channel config
    Object.assign(channelConfig, data.channel_config || {})
    channelConfig.name = channelConfig.name || data.label || ''
    if (!channelConfig.channel_type && data.value) {
      channelConfig.channel_type = data.value
    }

    if (cache) {
      // cache 模式下不重置状态，只更新 editable 标记
      useAgentFormStore.setState({ is_new: !+agent_id })
    } else {
      // 重置并初始化状态
      const store = useAgentFormStore.getState()
      useAgentFormStore.setState({
        agent_type: currentAgentType,
        agent_id: +agent_id || 0,
        is_new: !+agent_id,
        form_data: {
          ...store.form_data,
          logo: getAgentByAgentType(currentAgentType).icon || '',
          group_id: group_id || 0,
          custom_config: {
            ...store.form_data.custom_config,
            agent_type: currentAgentType,
          },
        },
      })

      // 加载详情
      if (+agent_id) {
        await useAgentFormStore.getState().loadDetailData()
      }

      // 加载分组选项
      useAgentFormStore.getState().loadGroupOptions()
    }
  }, [channelConfig])

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
        action: isNew ? 'create' : 'update',
      })
    }

    // close()
  }, [isNew, onSuccess, close])

  useImperativeHandle(ref, () => ({
    open,
    close,
    handleSave,
  }))

  return (
    <AgentForm
      ref={agentFormRef}
      agentType={agentType}
      showChannelConfig
      className={className}
    />
  )
})

AgentDrawer.displayName = 'AgentDrawer'

export default AgentDrawer
