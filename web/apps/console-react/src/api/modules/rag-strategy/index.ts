import service from '../../config'
import { handleError } from '../../error-handler'
import type {
  Strategy,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  ReorderStrategyRequest,
} from './types'

export const ragStrategyApi = {
  getList(): Promise<Strategy[]> {
    return service
      .get('/api/rag/v2/strategies?detail=1')
      .then((res: any) => res?.data ?? [])
      .catch(handleError)
  },
  create(data: CreateStrategyRequest): Promise<Strategy> {
    return service
      .post('/api/rag/v2/strategies', data)
      .then((res: any) => res?.data ?? res)
      .catch(handleError)
  },
  update(id: number | string, data: UpdateStrategyRequest): Promise<Strategy> {
    return service
      .put(`/api/rag/v2/strategies/${id}`, data)
      .then((res: any) => res?.data ?? res)
      .catch(handleError)
  },
  delete(id: number | string): Promise<unknown> {
    return service.delete(`/api/rag/v2/strategies/${id}`).catch(handleError)
  },
  reorder(data: ReorderStrategyRequest): Promise<unknown> {
    return service.post('/api/rag/v2/strategies/reorder', data).catch(handleError)
  },
}

export default ragStrategyApi
export * from './types'
