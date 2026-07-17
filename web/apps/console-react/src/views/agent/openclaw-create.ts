import {
  getOpenClawCompatibleAgentIconPath,
  getOpenClawCompatibleAgentMetadata,
  resolveOpenClawCompatibleAgentLogo,
  type CreateAgentDialogResult,
} from '@km/shared-business/agent-create'
import { getPublicPath } from '@/utils/config'

export function buildOpenClawEnterpriseAgentPayload({
  data,
  channelId,
  subscriptionGroupIds,
  internalGroupIds,
}: {
  data: CreateAgentDialogResult
  channelId: string | number
  subscriptionGroupIds: number[]
  internalGroupIds: number[]
}) {
  const metadata = getOpenClawCompatibleAgentMetadata(data.agentType)
  const customConfig: Record<string, any> = {
    agent_type: metadata.agentType,
    agent_mode: 'assistant',
    hostKind: metadata.hostKind,
    provider_id: 0,
    channel_id: channelId || 0,
    tencent_bot_id: '',
    coze_workspace_id: '',
    coze_bot_id: '',
    coze_bot_url: '',
    app_builder_bot_id: '',
    chat53ai_agent_id: '',
    channel_config: {},
  }
  if (metadata.runnerCommand) {
    customConfig.runnerCommand = metadata.runnerCommand
  }

  return {
    agent_type: 2,
    name: data.name,
    description: data.description,
    logo: resolveOpenClawCompatibleAgentLogo(data.logo || getOpenClawCompatibleAgentIconPath(metadata.agentType, getPublicPath), metadata.agentType),
    group_id: data.groupId || 0,
    channel_type: metadata.channelType,
    model: 'openclaw-ws',
    prompt: '',
    tools: [],
    use_cases: [],
    user_group_ids: internalGroupIds,
    subscription_group_ids: subscriptionGroupIds,
    configs: {
      completion_params: {
        temperature: 0.2,
        top_p: 0.75,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
      },
    },
    custom_config: customConfig,
    settings: {
      opening_statement: '',
      suggested_questions: [],
      file_parse: { enable: false },
      image_parse: { vision: false, enable: false },
      relate_agents: [],
      input_fields: [],
      output_fields: [],
    },
    scopes: [{ scope_type: 'company', target_id: 0 }],
    enable: true,
  }
}
