import { AGENT_TYPES, agents } from './config'
import type { AgentType } from './config'

// 从 agents 配置中提取所有 agent id
export const AGENT_TYPE = AGENT_TYPES

export type { AgentType }

// 从 agents 配置中构建分类
const AGENT_CATEGORIES = Object.entries(agents).reduce(
  (acc, [key, agent]) => {
    if (!agent.visible) return acc
    if (!acc[agent.category]) acc[agent.category] = []

    acc[agent.category].push(key)
    return acc
  },
  {} as Record<string, string[]>
)

export const AGENT_APP_OPTIONS = Object.entries(AGENT_CATEGORIES).map(([title, types]) => ({
  title,
  children: types.map((value) => {
    const agent = agents[value]
    return {
      value,
      label: `agent_app.${value}` || '',
      icon: agent.icon || '',
      response: agent.mode || '',
      channel_type: agent.channelType || 0
    }
  })
}))
