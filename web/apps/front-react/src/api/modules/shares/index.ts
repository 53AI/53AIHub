import request from '../../index'

export interface ShareCreateRequest {
  resource_type: number
  resource_id: string
  permission: number
  expired_time?: number
  password?: string
}

export interface ShareItem {
  id: string
  resource_type: number
  resource_id: string
  permission: number
  expired_time: number
  password: string
  created_time: number
  updated_time: number
  created_by: number
}

export const sharesApi = {
  /**
   * 创建分享
   */
  create(data: ShareCreateRequest) {
    return request.post('/api/shares', data)
  },

  /**
   * 获取分享列表
   */
  list(params: { resource_type?: number; resource_id?: string } = {}) {
    return request.get('/api/shares', { params }).then((res) => res.data)
  },

  /**
   * 删除分享
   */
  delete(share_id: string) {
    return request.delete(`/api/shares/${share_id}`)
  }
}

export default sharesApi
