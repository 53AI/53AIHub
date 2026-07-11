import service from '../../config'
import { handleError } from '../../error-handler'
import type {
  ExtractionTemplate,
  CreateExtractionTemplateRequest,
  UpdateExtractionTemplateRequest,
} from './types'

export const extractionTemplatesApi = {
  list(): Promise<ExtractionTemplate[]> {
    return service
      .get('/api/rag/v2/extraction-templates')
      .then((res: any) => res.data)
      .catch(handleError)
  },

  create(data: CreateExtractionTemplateRequest): Promise<ExtractionTemplate> {
    return service
      .post('/api/rag/v2/extraction-templates', data)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  update(id: number | string, data: UpdateExtractionTemplateRequest): Promise<ExtractionTemplate> {
    return service
      .put(`/api/rag/v2/extraction-templates/${id}`, data)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  delete(id: number | string): Promise<unknown> {
    return service
      .delete(`/api/rag/v2/extraction-templates/${id}`)
      .then(() => undefined)
      .catch(handleError)
  },
}

export default extractionTemplatesApi
export * from './types'

