export namespace Prompt {
  export interface State {
    prompt_id: number
    content: string
    created_time: number
    custom_config: string
    description: string
    eid: number
    group_ids: number[]
    is_liked: boolean
    likes: number
    name: string
    sort: number
    status: 0 | 1
    type: 1 | 2
    updated_time: number
    user_id: number
    views: number
  }
}
