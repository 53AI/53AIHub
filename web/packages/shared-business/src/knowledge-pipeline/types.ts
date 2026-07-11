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

export interface ParseMethod {
  key: string
  name: string
  desc: string
  icon: string
  detailedDesc?: string
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

// Config component props
export interface ConfigComponentProps<T = Record<string, any>> {
  config: T
  onChange: (config: T) => void
  disabled?: boolean
}

// PipelineBasicDialog props
export interface PipelineBasicDialogProps {
  onConfirm: (data: { name: string; description: string; icon: string }) => void
  onCancel: () => void
}

// PipelineDetail props
export interface PipelineDetailProps {
  pipeline: Pipeline
  onChange: (pipeline: Pipeline) => void
  open: boolean
  onClose: () => void
}
