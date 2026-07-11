export namespace Conversation {
  export interface Info {
    agent_id: string
    conversation_id: string
    created_time: number
    deleted_time: number
    eid: number
    last_message: string
    quota: number
    status: number
    title: string
    total_tokens: number
    updated_time: number
    user_id: number
    virtual_id: string
    created_at: string
    updated_at: string
  }

  export interface UserFile {
    type: 'image'
    content: string
    filename: string
    size: number
    mime_type: string
    url: string
  }

  export interface Message {
    agent_id: string
    answer: string
    channel: number
    completion_tokens: number
    conversation_id: string
    created_time: number
    eid: number
    elapsed_time: number
    id: number
    is_stream: true
    message: string
    model_name: string
    prompt_tokens: number
    quota: number
    quota_content: string
    request_id: string
    total_tokens: number
    updated_time: number
    user_id: number
    query: string
    loading?: boolean
    user_files: UserFile[]
    reasoning_content?: string
    reasoning_expanded?: boolean
  }

  export interface Sender {
    conversation_id: string
    frequency_penalty: number
    messages: {
      content: string
      role: 'user' | 'assistant'
    }[]
    model: string
    presence_penalty: number
    stream: boolean
    temperature: number
    top_p: number
    enable_graph_search?: boolean
  }

  export interface NextAgentPrepare {
    agent_id: string
    is_workflow: boolean
    execution_rule: 'auto' | 'manual'
    parameters: Record<string, any>
  }
}
