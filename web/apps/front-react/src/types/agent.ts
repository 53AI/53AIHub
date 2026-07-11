export namespace Agent {
  export interface State {
    agent_id: string
    bot_id?: string
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
  }
}
