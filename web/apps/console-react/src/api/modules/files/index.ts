import service from '../../config'
import { handleError } from '../../error-handler'
import type { RawFileItem, FileSearchParams, FileSearchResponse } from './types'
import type { AxiosRequestConfig } from 'axios'

export const filesApi = {
  get(id: RawFileItem['id']): Promise<RawFileItem> {
    return service
      .get(`/api/files/${id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  recently(params: { library_id?: RawFileItem['library_id'] } = {}): Promise<RawFileItem[]> {
    return service
      .get('/api/files/recently', { params, requiresAuth: true } as any)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  all(params: { library_id: string }, config?: AxiosRequestConfig): Promise<RawFileItem[]> {
    return service
      .get('/api/files/all', { ...config, params })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  search(params: FileSearchParams): Promise<FileSearchResponse> {
    return service
      .get('/api/files/search/by-name', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  getOutputFiles(id: string | number) {
    return service
      .get(`/api/messages/${id}/files`)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  downloadFile(id: string | number) {
    return service.get(`/api/sandbox-files/${id}/download`, {
      requiresAuth: true,
      responseType: 'blob',
    } as any)
  },
}

export default filesApi
export * from './types'
export * from './transform'

