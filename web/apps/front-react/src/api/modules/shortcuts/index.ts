import service from '../../config'
import { handleError } from '../../errorHandler'
import {
  ShortcutCreateRequest,
  ShortcutListResponse,
  ShortcutGetByRelatedParams,
  ShortcutItem,
} from './types'

const shortcutsApi = {
  /**
   * 获取所有快捷方式
   */
  list(): Promise<ShortcutListResponse> {
    return service.get('/api/shortcuts', { requiresAuth: true }).then(res => res.data).catch(handleError)
  },

  /**
   * 创建快捷方式
   */
  create(data: ShortcutCreateRequest): Promise<ShortcutItem> {
    return service.post('/api/shortcuts', data).then(res => res.data).catch(handleError)
  },

  /**
   * 根据相关ID获取快捷方式
   */
  getByRelated(params: ShortcutGetByRelatedParams): Promise<ShortcutItem | null> {
    return service
      .get('/api/shortcuts/by_related', { params })
      .then(res => res.data)
      .catch(handleError)
  },

  /**
   * 删除快捷方式
   */
  remove(id: string): Promise<void> {
    return service.delete(`/api/shortcuts/${id}`).then(res => res.data).catch(handleError)
  },
}

export default shortcutsApi
