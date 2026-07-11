import { useMemo } from 'react'
import { getOpenClawCompatibleAgentMetadata, useAgentFormStore } from '@km/shared-business/agent-create'
import { OpenClawPreviewWorkspace as SharedOpenClawPreviewWorkspace } from '@km/shared-business/chat'
import conversationApi from '@/api/modules/conversation'
import openclawApi from '@/api/modules/openclaw'
import uploadApi from '@/api/modules/upload'
import { api_host, getPublicPath } from '@/utils/config'

interface ConsoleOpenClawEmbeddedChatWorkspaceProps {
  className?: string
}

export function ConsoleOpenClawEmbeddedChatWorkspace({ className }: ConsoleOpenClawEmbeddedChatWorkspaceProps) {
  const agentId = useAgentFormStore((state) => state.agent_id)
  const formData = useAgentFormStore((state) => state.form_data)

  const savedAgentId = useMemo(() => {
    if (!agentId || agentId === 0 || agentId === '0') return ''
    return String(agentId)
  }, [agentId])

  const agentMetadata = useMemo(() => {
    return getOpenClawCompatibleAgentMetadata(formData.custom_config?.agent_type || formData.custom_config?.hostKind)
  }, [formData.custom_config?.agent_type, formData.custom_config?.hostKind])

  const agentInfo = useMemo(
    () => ({
      agent_id: savedAgentId,
      bot_id: formData.bot_id,
      logo: formData.logo || getPublicPath(`/agent/${agentMetadata.iconFileName}`),
      name: formData.name || agentMetadata.label,
      description: formData.description,
      channel_type: formData.channel_type || agentMetadata.channelType,
      custom_config_obj: formData.custom_config || {},
      settings_obj: formData.settings || {},
      use_cases: formData.use_cases || [],
      user_group_ids: formData.user_group_ids || [],
      owner_id: 1,
    }),
    [agentMetadata, formData, savedAgentId],
  )

  return (
    <SharedOpenClawPreviewWorkspace
      className={className}
      agentId={savedAgentId}
      agentInfo={agentInfo}
      apiHost={api_host}
      openclawApi={openclawApi}
      completions={(params, options) =>
        conversationApi.completions(params as any, {
          responseType: 'stream',
          isStream: true,
          onDownloadProgress: options.onDownloadProgress,
          signal: options.signal,
        } as any)
      }
      uploadFile={async (file) => {
        const res = await uploadApi.upload(file)
        return {
          id: res.data.id,
          url: `${api_host}/api/preview/${res.data.preview_key || ''}`,
          size: res.data.size,
          name: res.data.file_name,
          mime_type: res.data.mime_type,
          preview_key: res.data.preview_key,
        }
      }}
      getPublicPath={getPublicPath}
      requestSource="console"
      boxClassName="px-6 w-full"
    />
  )
}

export default ConsoleOpenClawEmbeddedChatWorkspace
