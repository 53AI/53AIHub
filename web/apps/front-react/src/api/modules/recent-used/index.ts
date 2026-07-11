import request from '../../index'
import type { RecentUsedSaveItem, RecentUsedItem } from './types'

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
   */
  list(): Promise<RecentUsedItem[]> {
    return request.get('/api/recent-used').then((res) => res.data)
  }
}

export default recentUsedApi
