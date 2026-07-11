import { RawAgentInfo, AgentInfo } from './index'
import { JSONParse } from '@km/shared-utils'

export const transformAgentInfo = (agent: RawAgentInfo): AgentInfo => {
  return {
    ...agent,
    settings: JSONParse(agent.settings, {}),
    tools: JSONParse(agent.tools, []),
    use_cases: JSONParse(agent.use_cases, []),
    custom_config: JSONParse(agent.custom_config, {}),
    configs: JSONParse(agent.configs, {}),
  }
}
