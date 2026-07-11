export interface PipelineStep {
  step_key: string
  name?: string
  description?: string
  config: Record<string, any>
  run_mode?: 'auto' | 'manual' | 'skip'
}

export interface PipelineProfileJson {
  steps: PipelineStep[]
}

export interface Pipeline {
  id: string | number
  name: string
  icon: string
  created_time?: number
  profile_json: PipelineProfileJson | string // 可能是字符串或对象
  stats?: {
    success_count?: number
    success_rate?: number
  }
}
