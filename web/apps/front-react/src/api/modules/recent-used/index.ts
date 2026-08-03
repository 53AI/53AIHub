import request from '../../index'
import type {
  RecentUsedListParams,
  RecentUsedSaveItem,
  RecentUsedItem,
} from './types'

const recentUsedApi = {
  /**
   * 保存最近使用记录（支持单条/批量）
   */
  save(data: RecentUsedSaveItem | RecentUsedSaveItem[]) {
    return request.post('/api/recent-used', data).then((res) => res.data)
  },

  /**
   * 获取最近使用列表
   * 按 updated_time 降序，已删除的资源自动跳过
   * 支持按 resource_type / space_id 在服务端过滤
   */
  list(params?: RecentUsedListParams): Promise<RecentUsedItem[]> {
    return request.get('/api/recent-used', { params }).then((res) => res.data)
  }
}

export default recentUsedApi
