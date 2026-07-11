import service from '../../config'
import { handleError } from '../../error-handler'
import { NAVIGATION_INIT_DATA } from '@/constants/navigation'

import type {
  NavigationListParams,
  CreateNavigationData,
  UpdateNavigationData,
  UpdateNavigationStatusData,
  UpdateNavigationSortData,
  SaveNavigationContentData,
} from './types'


/**
 * 导航管理 API
 */
export const navigationApi = {
  /**
   * 获取导航列表
   */
  list(params: NavigationListParams = {}) {
    const cleanParams = JSON.parse(JSON.stringify(params))
    return service
      .get('/api/navigations', { params: cleanParams })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  /**
   * 初始化导航数据
   */
  init() {
    return service.post('/api/navigations/init', [...NAVIGATION_INIT_DATA()]).catch(handleError)
  },

  /**
   * 获取导航详情
   */
  detail(navigation_id: number) {
    return service
      .get(`/api/navigations/${navigation_id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  /**
   * 创建导航
   */
  create(data: CreateNavigationData) {
    const payload = {
      ...data,
      config: JSON.stringify(data.config),
    }
    return service.post('/api/navigations', payload).catch(handleError)
  },

  /**
   * 更新导航
   */
  update(data: UpdateNavigationData) {
    const payload = {
      ...data,
      config: JSON.stringify(data.config),
    }
    return service.put(`/api/navigations/${data.navigation_id}`, payload).catch(handleError)
  },

  /**
   * 保存导航（创建或更新）
   */
  save(data: CreateNavigationData | UpdateNavigationData) {
    if ('navigation_id' in data && (data as any).navigation_id) {
      return this.update(data as UpdateNavigationData)
    }
    return this.create(data as CreateNavigationData)
  },

  /**
   * 删除导航
   */
  delete(navigation_id: number) {
    return service.delete(`/api/navigations/${navigation_id}`).catch(handleError)
  },

  /**
   * 更新导航状态
   */
  updateStatus(data: UpdateNavigationStatusData) {
    return service
      .patch(`/api/navigations/${data.navigation_id}/status`, { status: data.status })
      .catch(handleError)
  },

  /**
   * 更新导航排序
   */
  updateSort(sortList: UpdateNavigationSortData) {
    return service.post('/api/navigations/sort', sortList).catch(handleError)
  },

  /**
   * 保存导航内容
   */
  saveContent(data: SaveNavigationContentData) {
    return service
      .post(`/api/navigations/${data.navigation_id}/content`, {
        html_content: data.html_content,
      })
      .catch(handleError)
  },
}

export default navigationApi
export * from './types'

