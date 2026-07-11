import type { IUploadApi } from '@km/shared-business'
import request from '../utils/request'

export const agentUploadApi: IUploadApi = {
  upload(file: File, type?: string): Promise<any> {
    const formData = new FormData()
    formData.append('file', file)
    if (type) {
      formData.append('upload_target', type)
    }
    return request.post('/api/upload', formData)
  },
}