import {
  getOpenClawCompatibleAgentIconPath,
  getOpenClawCompatibleAgentMetadata,
  resolveOpenClawCompatibleAgentLogo,
  type CreateAgentDialogResult,
} from '@km/shared-business/agent-create'

export function buildOpenClawPersonalAgentPayload(data: CreateAgentDialogResult, channelId: string | number) {
  const metadata = getOpenClawCompatibleAgentMetadata(data.agentType)
  const customConfig: Record<string, any> = {
    agent_type: metadata.agentType,
    agent_mode: 'assistant',
    hostKind: metadata.hostKind,
    provider_id: 0,
    channel_id: channelId,
    channel_config: {},
  }
  if (metadata.runnerCommand) {
    customConfig.runnerCommand = metadata.runnerCommand
  }

  return {
    name: data.name,
    description: data.description,
    logo: resolveOpenClawCompatibleAgentLogo(data.logo || getOpenClawCompatibleAgentIconPath(metadata.agentType), metadata.agentType),
    channel_type: metadata.channelType,
    model: 'openclaw-ws',
    agent_type: 2,
    prompt: '',
    tools: JSON.stringify([]),
    use_cases: JSON.stringify([]),
    configs: JSON.stringify({
      completion_params: {
        temperature: 0.2,
        top_p: 0.75,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
      },
    }),
    custom_config: JSON.stringify(customConfig),
    settings: JSON.stringify({
      opening_statement: '',
      suggested_questions: [],
      file_parse: { enable: false },
      image_parse: { vision: false, enable: false },
      relate_agents: [],
      input_fields: [],
      output_fields: [],
    }),
    enable: true,
  }
}
