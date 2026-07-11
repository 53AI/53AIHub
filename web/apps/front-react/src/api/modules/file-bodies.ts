import request from '../index'

export interface UserItem {
  user_id: number
  username: string
  nickname: string
  avatar: string
  mobile: string
  email: string
  eid: number
  role: number
  group_id: number
  status: number
  expired_time: number
  last_login_time: number
  access_token: string
  related_id: number
  type: number
  add_admin_time: number
  openid: string
  unionid: string
  departments: any
  memberbindings: any
  group_ids: any
  created_time: number
  updated_time: number
}

export interface HistoryItem {
  id: string
  file_id: string
  library_id: number
  eid: number
  content: string
  user_id: number
  created_time: number
  updated_time: number
  user?: UserItem
}

export interface VersionItem {
  id: string
  file_body_id: number
  file_id: string
  version: string
  created_time: number
  updated_time: number
  file_body: HistoryItem
}

export interface ListParams {
  offset?: number
  limit?: number
}

export const fileBodiesApi = {
  /**
   * 创建历史版本
   */
  create(data: { content: string; file_id: string; library_id: string }) {
    return request.post('/api/file-bodies', data)
  },

  /**
   * 获取最新的文件内容
   */
  find(file_id: string): Promise<{ content: string; updated_time: number }> {
    return request.get(`/api/file-bodies/last/${file_id}`).then((res) => res.data)
  },

  /**
   * 获取历史版本列表
   */
  history(file_id: string, { offset = 0, limit = 10 }: ListParams): Promise<HistoryItem[]> {
    return request
      .get(`/api/file-bodies/${file_id}`, { params: { offset, limit } })
      .then((res) => res.data.file_bodies)
  },

  /**
   * 重新转换文件
   */
  reconvert(file_id: string, data: { parse_type: string }) {
    return request.post(`/api/file-bodies/${file_id}/reconvert`, data)
  },

  versions: {
    list(file_id: string, { offset = 0, limit = 10 }: ListParams): Promise<VersionItem[]> {
      return request
        .get(`/api/file-body-versions/${file_id}`, { params: { offset, limit } })
        .then((res) => res.data.versions || [])
    },

    create(file_body_id: string, data: { version: string }) {
      return request.post(`/api/file-body-versions/file-body/${file_body_id}`, data)
    },

    update(id: number, data: { version: string }) {
      return request.put(`/api/file-body-versions/${id}`, data)
    },

    delete(id: number) {
      return request.delete(`/api/file-body-versions/${id}`)
    },

    preview(body_id: string, filename: string): Promise<string> {
      return request.get(`/api/file-version/${body_id}/${encodeURIComponent(filename)}`)
    }
  }
}

export default fileBodiesApi
