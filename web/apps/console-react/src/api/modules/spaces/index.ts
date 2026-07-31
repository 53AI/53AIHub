import service from '../../config'
import { handleError } from '../../errorHandler'

import type {
  SpaceListResponse,
  SpaceListRequest,
  SpaceCreateRequest,
  SpaceItem,
  SpaceRecycleItem,
  SpaceRecycleListRequest,
  SpaceRecycleListResponse,
} from './types'

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

  /**
   * 空间回收站列表 (后端接口路径待定, 此处先以 TODO 占位)
   */
  recycleList(
    params: SpaceRecycleListRequest,
  ): Promise<SpaceRecycleListResponse> {
    // TODO: 后端接口就绪后, 把 `/api/spaces/recycle` 替换为真实路径
    return service
      .get('/api/spaces/recycle', { params })
      .then((res: any) => res?.data || { items: [], count: 0 })
      .catch(err =>
        handleError(err, { functionName: window.$t('space.recycle.title') }),
      )
  },

  /**
   * 恢复空间回收站文件 (后端接口路径待定)
   */
  recycleRecover(ids: string[]): Promise<void> {
    // TODO: 后端接口就绪后校正路径与请求体
    return service
      .post('/api/spaces/recycle/recover', { ids })
      .catch(err =>
        handleError(err, { functionName: window.$t('space.recycle.recover') }),
      )
  },

  /**
   * 彻底删除空间回收站文件 (后端接口路径待定)
   */
  recycleDelete(ids: string[]): Promise<void> {
    // TODO: 后端接口就绪后校正路径与请求体
    return service
      .post('/api/spaces/recycle/delete', { ids })
      .catch(err =>
        handleError(err, { functionName: window.$t('space.recycle.delete') }),
      )
  },
}

export default spacesApi
export * from './types'
export * from './transform'

