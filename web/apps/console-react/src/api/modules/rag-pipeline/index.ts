import service from '../../config'
import { handleError } from '../../error-handler'
import type { Pipeline, CreatePipelineRequest, UpdatePipelineRequest } from './types'

export const ragPipelineApi = {
  getList(): Promise<Pipeline[]> {
    return service
      .get('/api/rag/v2/pipelines')
      .then((res: any) => {
        const data = res?.data ?? res ?? []
        return (Array.isArray(data) ? data : []).map((item: Pipeline) => {
          try {
            return {
              ...item,
              profile_json:
                typeof item.profile_json === 'string'
                  ? JSON.parse(item.profile_json)
                  : item.profile_json,
            }
          } catch {
            return { ...item, profile_json: { steps: [] } }
          }
        })
      })
      .catch(handleError)
  },
  getById(id: number | string): Promise<Pipeline> {
    return service
      .get(`/api/rag/v2/pipelines/${id}`)
      .then((res: any) => {
        const data = res?.data ?? res ?? {}
        try {
          return {
            ...data,
            profile_json:
              typeof data.profile_json === 'string'
                ? JSON.parse(data.profile_json)
                : data.profile_json,
          }
        } catch {
          return { ...data, profile_json: { steps: [] } }
        }
      })
      .catch(handleError)
  },
  create(data: CreatePipelineRequest): Promise<Pipeline> {
    return service
      .post('/api/rag/v2/pipelines', data)
      .then((res: any) => res?.data ?? res)
      .catch(handleError)
  },
  update(id: number | string, data: UpdatePipelineRequest): Promise<Pipeline> {
    return service
      .put(`/api/rag/v2/pipelines/${id}`, data)
      .then((res: any) => res?.data ?? res)
      .catch(handleError)
  },
  delete(id: number | string): Promise<unknown> {
    return service.delete(`/api/rag/v2/pipelines/${id}`).catch(handleError)
  },
}

export default ragPipelineApi
export * from './types'
