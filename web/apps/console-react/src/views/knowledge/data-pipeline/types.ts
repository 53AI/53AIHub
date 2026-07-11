export type PipelineNodeRunMode = 'auto' | 'manual' | 'skip'

export type PipelineNodeStepKey =
  | 'document_parsing'
  | 'content_cleaning'
  | 'summary_generation'
  | 'document_chunking'
  | 'vector_indexing'
  | 'graph_generation'

export interface PipelineNode {
  step_key: PipelineNodeStepKey
  run_mode: PipelineNodeRunMode
  config: Record<string, any>
  name?: string
  description?: string
}

export interface PipelineStats {
  total: number
  success_rate: number
}
export interface PipelineStep {
  step_key: string
  name?: string
  description?: string
  config: Record<string, any>
  run_mode?: PipelineNodeRunMode
}

export interface PipelineProfileJson {
  steps: PipelineStep[]
}

export interface Pipeline {
  id: string | number
  name: string
  icon: string
  created_at: string
  profile_json: PipelineProfileJson
  stats: PipelineStats
}
