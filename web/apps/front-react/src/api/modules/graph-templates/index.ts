import service from '@/api/config'
import { handleError } from '@/api/errorHandler'

import type {
  GraphTemplateListResponse,
  GraphTemplateDetail,
  CreateGraphTemplateRequest,
  UpdateGraphTemplateRequest,
  SuggestRelationsRequest,
  SuggestRelationsResponse,
} from './types'

export const graphTemplatesApi = {
  list(params?: { offset?: number; limit?: number; keyword?: string }): Promise<GraphTemplateListResponse> {
    return service
      .get('/api/graph-templates', { params })
      .then(res => res.data)
      .catch(handleError)
  },

  get(id: string): Promise<GraphTemplateDetail> {
    return service
      .get(`/api/graph-templates/${id}`)
      .then(res => res.data)
      .catch(handleError)
  },

  create(data: CreateGraphTemplateRequest): Promise<GraphTemplateDetail> {
    return service
      .post('/api/graph-templates', data)
      .then(res => res.data)
      .catch(handleError)
  },

  update(id: string, data: UpdateGraphTemplateRequest): Promise<GraphTemplateDetail> {
    return service
      .put(`/api/graph-templates/${id}`, data)
      .then(res => res.data)
      .catch(handleError)
  },

  remove(id: string): Promise<boolean> {
    return service
      .delete(`/api/graph-templates/${id}`)
      .then(res => Boolean(res.data))
      .catch(handleError)
  },

  suggestRelations(data: SuggestRelationsRequest): Promise<SuggestRelationsResponse> {
    return service
      .post('/api/graph-templates/suggest-relations', data)
      .then(res => res.data)
      .catch(handleError)
  },
}

export default graphTemplatesApi
