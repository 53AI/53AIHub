import request from '../../index'
import type {
  FileShareCreateRequest,
  FileShareCreateResponse,
  FileShareGetResponse
} from './types'

const fileSharesApi = {
  /**
   * 创建文件分享
   */
  create(data: FileShareCreateRequest): Promise<FileShareCreateResponse> {
    return request.post('/api/file-shares', data).then((res) => res.data)
  },

  /**
   * 获取文件分享信息
   */
  get(id: string): Promise<FileShareGetResponse> {
    return request.get(`/api/file-shares/${id}`).then((res) => res.data)
  }
}

export default fileSharesApi
