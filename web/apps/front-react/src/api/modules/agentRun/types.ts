export namespace AgentRun {
  export type Status = 'queued' | 'running' | 'requires_action' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

  export type EventType =
    | 'run.created'
    | 'run.status_changed'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled'
    | 'message.delta'
    | 'message.completed'
    | 'step.created'
    | 'process.step'
    | 'heartbeat'

  export interface Info {
    id: string
    run_id: string
    conversation_id: string
    message_id: string | number
    status: Status
    created_at: number
    updated_at: number
  }

  export interface ListResponse {
    count: number
    runs: Info[]
  }

  export interface EventRaw {
    seq: number
    type: EventType
    payload_json?: string
    created_at: number
  }

  export interface Event {
    seq: number
    type: EventType
    payload: Record<string, any>
    created_at: number
    message_id?: string | number
    run_id?: string
    request_id?: string
  }

  export interface ReplayResponse {
    run: Info
    events: Event[]
  }

  export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
}

export const RUNNING_STATUSES: AgentRun.Status[] = ['queued', 'running', 'requires_action']
export const TERMINAL_STATUSES: AgentRun.Status[] = ['completed', 'failed', 'cancelled']
export const TERMINAL_EVENTS: AgentRun.EventType[] = ['run.completed', 'run.failed', 'run.cancelled']
