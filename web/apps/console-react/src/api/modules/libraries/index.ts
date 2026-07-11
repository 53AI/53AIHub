import service from '../../config'
import { handleError } from '../../error-handler'

import type { LibraryDisplayItem, LibraryListRequest, LibraryCreateRequest } from './types'
import { transformLibraryList } from './transform'

export const librariesApi = {
  list(params: LibraryListRequest): Promise<LibraryDisplayItem[]> {
    return service
      .get('/api/libraries', { params })
      .then((res: any) => transformLibraryList(res.data))
      .catch(handleError) as any
  },

  create(data: LibraryCreateRequest) {
    return service.post('/api/libraries', data).catch(handleError)
  },

  update(library_id: number, data: LibraryCreateRequest) {
    return service.put(`/api/libraries/${library_id}`, data).catch(handleError)
  },

  delete(library_id: number) {
    return service.delete(`/api/libraries/${library_id}`).catch(handleError)
  },
}

export default librariesApi
export * from './types'
export * from './transform'

