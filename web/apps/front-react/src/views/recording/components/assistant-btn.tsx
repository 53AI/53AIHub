import { useEffect, useState } from 'react'
import { useLibraryStore } from '@/stores/modules/library'
import { useRecordingStore } from '@/stores/modules/recording'
import { eventBus } from '@km/shared-utils'
import { t } from '@/locales'
import { IconAction } from "@km/shared-components-react"
import agentsApi from '@/api/modules/agents'
import { AGENT_USAGES } from '@/constants/agent'
import { AI_ICON_URL } from '@/views/library/main/file/components/sidebar-app-item'

/**
 * 安心录右栏「文档助手」入口。
 *
 * 与知识库 AssistantBtn 的差异：展示判定不依赖知识库共享的 assistantInstall
 * （那套由 recording_agent_enabled 闸门驱动），改成安心录自身的 OR 判定，
 * 任一项满足即展示入口：
 *   - agent_usages=5 的聊天 agent 至少一个 enable=true
 *   - 或 recordingConfig.insight_regenerate_enabled = true
 */
export function AssistantBtn() {
  const assistantVisible = useLibraryStore((state) => state.assistantVisible)
  const setAssistantVisible = useLibraryStore((state) => state.setAssistantVisible)
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)

  // usage=5 的聊天 agent 是否有启用项
  const [chatAgentEnabled, setChatAgentEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    agentsApi
      .list({ agent_usages: String(AGENT_USAGES.KM_RECORDING_CHAT) })
      .then((res) => {
        if (cancelled) return
        setChatAgentEnabled(res.agents.some((item) => item.enable))
      })
      .catch(() => {
        if (cancelled) return
        setChatAgentEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 参谋洞察开关：为 true 时即使没有启用聊天 agent，也要能打开面板使用「参谋洞察」
  const insightRegenerateEnabled = !!recordingConfig?.insight_regenerate_enabled

  if (!chatAgentEnabled && !insightRegenerateEnabled) return null

  const handleClick = () => {
    if (!assistantVisible) {
      setAssistantVisible(true)
      return
    }
    eventBus.emit('assistant-toggle')
  }

  return (
    <IconAction
      title={t('library.document_chat')}
      size="medium"
      onClick={handleClick}
      activeClassName={assistantVisible ? 'bg-[#F2F6FE]' : ''}
    >
      <img className="size-5" src={AI_ICON_URL} alt="" />
    </IconAction>
  )
}

export default AssistantBtn