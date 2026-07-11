import service from '../config'
import { handleError } from '../errorHandler'

interface Pipeline {
  pipeline_id: number
  name: string
  stages: any[]
  status: number
  created_time: string
}

interface PipelineListResponse {
  list: Pipeline[]
  total: number
}

export const knowledgeApi = {
  async getDataPipelines(): Promise<PipelineListResponse> {
    const res = await service.get('/api/knowledge/pipelines').catch(handleError) as any
    return {
      list: res?.data?.list || [],
      total: res?.data?.total || 0,
    }
  },
}

export default knowledgeApi