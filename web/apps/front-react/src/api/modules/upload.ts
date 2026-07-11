import request from '../index'

export type UploadTarget = 'attachment' | 'my_uploads'

export interface UploadedFileData {
  id: string
  file_name: string
  extension: string
  mime_type: string
  size: number
  hash: string
  key: string
  preview_key: string
  status: string
}

export interface UploadResponse {
  data: UploadedFileData
  code?: number
  message?: string
}

export const uploadApi = {
  /**
   * 上传文件
   * @param file 文件
   * @param upload_target 上传目标：attachment（仅附件）或 my_uploads（同步到个人知识库）
   */
  upload(file: File, upload_target?: UploadTarget): Promise<UploadResponse> {
    const formData = new FormData()
    formData.append('file', file)
    if (upload_target) {
      formData.append('upload_target', upload_target)
    }
    return request.post('/api/upload', formData)
  },

  /**
   * 预览文件
   */
  preview(key: string) {
    return request.get(`/api/preview/${key}`)
  }
}

export default uploadApi
