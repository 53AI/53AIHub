import type { ScopeItem } from '@km/shared-business/agent-create'

declare namespace Agent {
  interface State {
    agent_id: string
    channel_type: number
    configs: string
    created_by: number
    created_time: number
    description: string
    eid: number
    group_id: number
    logo: string
    model: string
    name: string
    prompt: string
    sort: number
    tools: string
    updated_time: number
    use_cases: string
    user_group_ids: number[]
    custom_config: string
    custom_config_obj: any
    settings: string
    settings_obj: any
    conversation_count: number
    /** 智能体用途类型 */
    agent_usage?: number
    /** 权限范围 */
    scopes?: ScopeItem[]
  }
}
