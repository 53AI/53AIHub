import service from '../../config'
import { handleError } from '../../errorHandler'

import type { SpaceListResponse, SpaceListRequest, SpaceCreateRequest, SpaceItem } from './types'

export const spacesApi = {
  list(params: SpaceListRequest): Promise<SpaceListResponse> {
    return service
      .get('/api/spaces', { params })
      .then((res: any) => res?.data || { spaces: [], count: 0 })
      .catch(err => handleError(err, { functionName: window.$t('space.name') }))
  },

  create(data: SpaceCreateRequest) {
    return service
      .post('/api/spaces', data)
      .catch(err => handleError(err, { functionName: window.$t('space.name') }))
  },

  update(space_id: SpaceItem['id'], data: SpaceCreateRequest) {
    return service.put(`/api/spaces/${space_id}`, data).catch(handleError)
  },

  delete(space_id: SpaceItem['id']) {
    return service.delete(`/api/spaces/${space_id}`).catch(handleError)
  },

  detail(space_id: SpaceItem['id']): Promise<SpaceItem> {
    return service
      .get(`/api/spaces/${space_id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
}

export default spacesApi
export * from './types'
export * from './transform'

