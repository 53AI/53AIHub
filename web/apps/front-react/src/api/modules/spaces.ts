import { PermissionType } from '@/components/KMPermission/constant'
import service from '../config'
import { handleError } from '../errorHandler'

export type SpaceItem = {
  created_time: number
  description: string
  eid: number
  icon: string
  id: string
  name: string
  owner_id: number
  sort: number
  status: number
  library_count: number
  updated_time: number
  permission: PermissionType
  visibility: number
}

export type SpaceListResponse = {
  spaces: SpaceItem[]
  total: number
}

export type SpaceListRequest = {
  status: number
  offset: number
  limit: number
  name?: string
  view: 'user'
}

export type SpaceCreateRequest = {
  name: string
  description: string
  icon: string
}



export const spacesApi = {
  list(data: SpaceListRequest): Promise<SpaceListResponse> {
    return service
      .get('/api/spaces', { params: data, requiresAuth: true })
      .then((res) => res.data)
      .catch(err => handleError(err, { functionName: window.$t('module.space') }))
  },
  create(data: SpaceCreateRequest) {
    return service.post('/api/spaces', data).catch(handleError)
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
      .then((res) => res.data)
      .catch(handleError)
  },
  get(space_id: SpaceItem['id']): Promise<SpaceItem> {
    return service
      .get(`/api/spaces/${space_id}`)
      .then((res) => res.data)
      .catch(handleError)
  }
}

export default spacesApi
