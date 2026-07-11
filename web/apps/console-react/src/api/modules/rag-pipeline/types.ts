export interface PipelineStep {
  enabled: boolean
  step_key: string
  config: Record<string, unknown>
  run_mode?: 'auto' | 'manual' | 'skip'
}

export interface PipelineProfileJson {
  steps: PipelineStep[]
}

export interface PipelineStats {
  success_count: number
  failure_count: number
  success_rate: number
  last_run_time?: number
}

export interface Pipeline {
  id: string
  eid: number
  name: string
  icon: string
  profile_json: string | PipelineProfileJson
  created_time: number
  updated_time: number
  stats?: PipelineStats
}

export interface CreatePipelineRequest {
  name: string
  icon: string
  profile_json: PipelineProfileJson
}

export interface UpdatePipelineRequest {
  name?: string
  icon: string
  profile_json: PipelineProfileJson
}
