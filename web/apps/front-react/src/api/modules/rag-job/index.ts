import request from '../../index'

export interface RagJobRequestParams {
  related_id?: string
  status?: string
  offset?: number
  limit?: number
}

export interface RagJobStep {
  id: number
  job_id: number
  step_name: string
  status: string
  started_at: number
  completed_at: number
  error_message: string
  config: Record<string, any>
}

export interface RagJobItem {
  id: number
  related_id: string
  status: string
  created_time: number
  updated_time: number
  steps: RagJobStep[]
}

export interface RagJobData {
  jobs: RagJobItem[]
  total: number
}

export interface RagJobByRelatedResponse {
  jobs: RagJobItem[]
  total: number
}

export const ragJobApi = {
  list(params: RagJobRequestParams): Promise<RagJobData> {
    return request.get('/api/rag/jobs', { params }).then((res) => res.data)
  },

  cancel(job_id: number) {
    return request.put(`/api/rag/v2/jobs/${job_id}/cancel`).then((res) => res.data)
  },

  getByRelatedId(related_id: string): Promise<RagJobByRelatedResponse> {
    return request.get('/api/rag/v2/jobs/by-related', { params: { related_id } }).then((res) => res.data)
  },

  retry(job_id: number, data: { config?: Record<string, any>; continue: boolean }) {
    return request.post(`/api/rag/v2/jobs/${job_id}/retry`, data).then((res) => res.data)
  },

  batchRetry(data: {
    run: { related_id: string; strategy_id: string; pipeline_id: string; start_parameters: Record<string, any> }
    jobs: Array<{ job_id: number; config?: Record<string, any> }>
  }) {
    return request.post('/api/rag/v2/jobs/batch-retry', data).then((res) => res.data)
  }
}

export default ragJobApi
