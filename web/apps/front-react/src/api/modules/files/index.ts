import request from '../../index'
import {
  BatchUploadFileParams,
  BatchUploadFileResponse,
  BatchUploadInitParams,
  BatchUploadInitResponse,
  BatchUploadProgressResponse,
  CheckUploadResponse,
  FileListParams,
  FileLockParams,
  FileLockResponse,
  RawFileItem,
  RecycleListParams,
  RecycleListResponse,
  ParentExistsResponse,
  FileSearchParams,
  FileSearchResponse
} from './types'

import { PermissionItem } from '../permissions'

export const filesApi = {
  list(params: FileListParams): Promise<RawFileItem[]> {
    return request.get('/api/files', { params }).then((res) => res.data)
  },

  all(params: { library_id: string }): Promise<RawFileItem[]> {
    return request.get('/api/files/all', { params }).then((res) => res.data)
  },

  allStats(params: { library_id: string }): Promise<{
    completed_count: number
    queued_count: number
    failed_interrupted_count: number
    avg_completion_time: number
  }> {
    return request.get('/api/files/all/stats', { params }).then((res) => res.data)
  },

  get(id: RawFileItem['id']): Promise<RawFileItem> {
    return request.get(`/api/files/${id}`).then((res) => res.data)
  },

  create(data: {
    path: RawFileItem['path']
    type: number
    library_id: RawFileItem['library_id']
    permissions: PermissionItem[]
  }): Promise<RawFileItem> {
    return request.post('/api/files', data).then((res) => res.data)
  },

  rename(data: { id: RawFileItem['id']; path: RawFileItem['path'] }) {
    return request.put('/api/files/rename', data)
  },

  sort(data: { files: { id: RawFileItem['id']; sort: number }[] }) {
    return request.post('/api/files/sort', data)
  },

  delete(id: RawFileItem['id']) {
    return request.delete(`/api/files/${id}`)
  },

  raw(id: RawFileItem['id'], data: { content: string }): Promise<void> {
    return request.put(`/api/files/${id}/raw`, data).then((res) => res.data)
  },

  recently(params: {
    library_id?: RawFileItem['library_id']
    resource_type?: number // 1=library, 2=file
    page?: number
    limit?: number
    keyword?: string
  } = {}): Promise<RawFileItem[]> {
    return request.get('/api/files/recently', { params, requiresAuth: true }).then((res) => res.data)
  },

  recentlyUpdated(params: { library_id?: RawFileItem['library_id'] } = {}): Promise<RawFileItem[]> {
    return request.get('/api/files/recently-updated', { params }).then((res) => res.data)
  },

  lock(id: string, data: FileLockParams): Promise<FileLockResponse> {
    return request.post(`/api/files/${id}/edit-lock`, data).then((res) => res.data)
  },

  search(params: FileSearchParams): Promise<FileSearchResponse> {
    return request.get('/api/files/search/by-name', { params }).then((res) => res.data)
  },

  generateQuestionAndSummary(id: string) {
    return request.post(`/api/files/${id}/generate-questions-and-summary`).then((res) => res.data)
  },

  // 批量上传相关接口
  batchUploadInit(data: BatchUploadInitParams): Promise<BatchUploadInitResponse> {
    return request.post('/api/files/upload/batch/init', data).then((res) => res.data)
  },

  /**
   * 秒传预检：按文件 SHA-256 查询同企业内是否已有 UploadFile。
   * 命中则跳过 multipart 上传，直接使用返回的 file.id 作为 upload_file_id。
   */
  checkUpload(hash: string): Promise<CheckUploadResponse> {
    return request
      .get('/api/upload/check', { params: { hash } })
      .then((res) => res.data)
      .catch((err: any) => {
        // 接口不存在或后端未升级时降级为未命中，让前端走原 batch 上传
        const status = err?.response?.status
        if (status === 404 || status === 501) {
          return { exists: false } as const
        }
        throw err
      })
  },

  batchUploadFile(batchId: string, data: BatchUploadFileParams): Promise<BatchUploadFileResponse> {
    const formData = new FormData()
    Object.entries(data).forEach(([key, value]) => {
      // 秒传命中时 file 与 hash 二选一：未传则跳过 append
      if (value === undefined) return
      formData.append(key, value as string | Blob)
    })

    return request
      .post(`/api/files/upload/batch/${batchId}/file`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      .then((res) => res.data)
  },

  batchUploadProgress(
    batchId: string,
    params?: { detail?: boolean; file_upload_id?: string; since?: number }
  ): Promise<BatchUploadProgressResponse> {
    return request.get(`/api/files/upload/batch/${batchId}/progress`, { params }).then((res) => res.data)
  },

  batchUploadCancel(batchId: string): Promise<{ batch_id: string; status: string }> {
    return request.delete(`/api/files/upload/batch/${batchId}`).then((res) => res.data)
  },

  recycleList(params: RecycleListParams): Promise<RecycleListResponse> {
    return request.get('/api/files/recycle-bin', { params }).then((res) => res.data)
  },

  hardDelete(id: RawFileItem['id']): Promise<void> {
    return request.delete(`/api/files/${id}/hard-delete`).then((res) => res.data)
  },

  parentExists(id: RawFileItem['id']): Promise<ParentExistsResponse> {
    return request.get(`/api/files/${id}/parent-exists`).then((res) => res.data)
  },

  restore(id: RawFileItem['id'], data?: { restore_to_root_if_parent_missing?: boolean }): Promise<void> {
    return request.post(`/api/files/${id}/restore`, data).then((res) => res.data)
  },

  indexStatus(file_id: string, data: { status: 'normal' | 'disabled' }) {
    return request.put(`/api/files/${file_id}/index-status`, data).then((res) => res.data)
  },

  generateKnowledgeMap(file_id: string) {
    return request.post(`/api/files/${file_id}/generate-knowledge-map`).then((res) => res.data)
  },

  recordQueryMap(file_id: string) {
    return request.post(`/api/files/${file_id}/knowledge-map/record-query`).then((res) => res.data)
  },

  generatedContent(file_id: string, data: { summary?: string; questions?: string[]; knowledge_map?: string }) {
    return request.put(`/api/files/${file_id}/generated-content`, data).then((res) => res.data)
  },
  chunks(file_id: string, params: { chunk_ids: string }): Promise<{ items: any; }[]> {
    return request
      .get(`/api/files/${file_id}/chunks`, { params })
      .then((res) => res.data)
      .catch((err) => {
        console.error(err)
        return []
      })
  },
  getOutputFiles(id: string | number) {
    return request
      .get(`/api/messages/${id}/files`)
      .then((res) => res.data)
      .catch((err) => {
        console.error(err)
        return null
      })
  },
  downloadFile(id: string | number) {
    return request.get(`/api/sandbox-files/${id}/download`, { requiresAuth: true, responseType: 'blob' })
  },

  graph: {
    list(params: { file_id: string; limit?: number; entity_type?: string; keyword?: string }): Promise<any> {
      const { file_id, ...query } = params
      return request
        .get(`/api/files/${file_id}/graph`, { params: query })
        .catch((err) => {
          console.error(err)
          return null
        })
    }
  }
}

export default filesApi
