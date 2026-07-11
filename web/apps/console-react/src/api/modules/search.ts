import service from '../config'
import { handleError } from '../errorHandler'

interface RecordParams {
  keyword?: string
  start_time?: string
  end_time?: string
  offset?: number
  limit?: number
}

interface RecordItem {
  id: number
  query: string
  answer: string
  model: string
  tokens: number
  latency: number
  created_time: string
  user_name: string
}

interface RecordListResponse {
  list: RecordItem[]
  total: number
}

export const searchApi = {
  async getRecords(params: RecordParams = {}): Promise<RecordListResponse> {
    const res = await service.get('/api/search/records', { params }).catch(handleError) as any
    return {
      list: res?.data?.list || [],
      total: res?.data?.total || 0,
    }
  },
}

export default searchApi