import request from '../../index'

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
  profile_json: PipelineProfileJson | string
  stats?: {
    success_count?: number
    success_rate?: number
  }
}

export interface CreatePipelineParams {
  name: string
  icon: string
  profile_json: PipelineProfileJson
}

export interface UpdatePipelineParams extends CreatePipelineParams {}

export const ragPipelineApi = {
  /**
   * Get pipeline list
   */
  getList(): Promise<Pipeline[]> {
    return request.get('/api/rag/v2/pipelines').then((res) => {
      const data = res.data?.data || res.data
      return Array.isArray(data) ? data : []
    })
  },

  /**
   * Get pipeline detail
   */
  get(id: string | number): Promise<Pipeline> {
    return request.get(`/api/rag/v2/pipelines/${id}`).then((res) => {
      const data = res.data?.data || res.data
      if (!data) {
        throw new Error('Pipeline data is empty')
      }
      return data
    })
  },

  /**
   * Create pipeline
   */
  create(params: CreatePipelineParams): Promise<Pipeline> {
    return request.post('/api/rag/v2/pipelines', params).then((res) => {
      const data = res.data?.data || res.data
      return data
    })
  },

  /**
   * Update pipeline
   */
  update(id: string | number, params: UpdatePipelineParams): Promise<Pipeline> {
    return request.put(`/api/rag/v2/pipelines/${id}`, params).then((res) => {
      const data = res.data?.data || res.data
      return data
    })
  },

  /**
   * Delete pipeline
   */
  delete(id: string | number): Promise<void> {
    return request.delete(`/api/rag/v2/pipelines/${id}`).then(() => {})
  },
}

export default ragPipelineApi
