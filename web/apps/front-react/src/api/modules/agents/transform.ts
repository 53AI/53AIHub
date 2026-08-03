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

/**
 * 把后端返回的字符串字段解析为 *_obj 对象,供 `Agent.State` 等 store 类型使用。
 * 与 `transformAgentInfo` 不同:后者输出 `AgentInfo`(用 `settings` 字段),
 * 本函数输出带 `settings_obj` / `custom_config_obj` 的版本,与 store 和 views/chat 的下游消费方对齐。
 */
export function parseAgentParsedFields<
  T extends { settings?: string; custom_config?: string },
>(raw: T): T & { settings_obj: Record<string, any>; custom_config_obj: Record<string, any> } {
  return {
    ...raw,
    settings_obj: JSONParse(raw.settings ?? '', {}),
    custom_config_obj: JSONParse(raw.custom_config ?? '', {}),
  }
}
