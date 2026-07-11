export interface RagJobRequestParams {
  page: number
  page_size: number
  status: string
  type: string
}

export interface RagJobItem {
  created_time: number
  current_step_order: number
  eid: string | number
  failure_reason: string
  job_id: number
  metadata: string
  start_parameters: string
  status: string
  type: string
  updated_time: number
}

export interface RagJobDisplayedItem extends RagJobItem {
  file_info?: {
    icon: string
    id: number
    name: string
    size: number
    type: string
  }
}

export interface RagJobData {
  jobs: RagJobDisplayedItem[]
  total: number
}

export const QueueType = {
  CONVERT: 'convert',
  INDEX: 'index',
  AI_GENERATE_INDEX: 'ai_generate_index',
} as const

export type Queue_Type = (typeof QueueType)[keyof typeof QueueType]

// 任务类型，多个类型用逗号隔开
export const JobType = {
  [QueueType.CONVERT]: 'document_conversion',
  [QueueType.INDEX]: 'rechunk_and_reindex,reindex,auto_chunking',
  [QueueType.AI_GENERATE_INDEX]: 'ai_generate_index',
}

/**
 * 任务步骤
 */
export interface RagJobStep {
  id: string | number
  job_id: number
  eid: string | number
  step_order: number
  parameters: string
  results: string
  status: string
  start_time: number
  end_time: number
  created_time: number
  updated_time: number
}

/**
 * 任务详情（包含步骤）
 */
export interface RagJobWithSteps extends RagJobItem {
  run_id: string
  related_id: string | number
  pipeline_id: number
  progress: number
  completion_time: number
  steps: RagJobStep[]
  runtime_profile_json?: string
}

/**
 * 通过 related_id 获取任务批次响应
 */
export interface RagJobByRelatedResponse {
  related_id: string | number
  run_id: string
  jobs: RagJobWithSteps[]
}
