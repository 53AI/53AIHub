import request from '../index'

export interface ApiKey {
  id: number
  name: string
  description: string
  eid: number
  creator_id: number
  status: number
  created_time: number
  updated_time: number
  expires_at: number | null
  key: string
}

export interface ApiKeysRequest {
  name: string
  description: string
}

export const apiKeysApi = {
  /**
   * 获取 API Key 列表
   */
  list(library_id: string): Promise<ApiKey[]> {
    return request.get(`/api/libraries/${library_id}/api-keys`).then((res) => res.data.api_keys)
  },

  /**
   * 创建 API Key
   */
  create(library_id: string, data: ApiKeysRequest) {
    return request.post(`/api/libraries/${library_id}/api-keys`, data)
  },

  /**
   * 删除 API Key
   */
  delete(library_id: string, id: ApiKey['id']) {
    return request.delete(`/api/libraries/${library_id}/api-keys/${id}`)
  }
}

export const personalApiKeysApi = {
  list(): Promise<ApiKey[]> {
    return request.get('/api/api-keys', { params: { type: 'personal' } }).then((res) => res.data.api_keys)
  },

  create(data: ApiKeysRequest = { name: 'mcp', description: 'mcp' }) {
    return request.post('/api/api-keys', data)
  },

  delete(id: ApiKey['id']) {
    return request.delete(`/api/api-keys/${id}`)
  }
}

export default apiKeysApi
