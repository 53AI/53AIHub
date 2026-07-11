/**
 * 上传相关类型定义
 */

// 基础文件信息接口
export interface BaseFileInfo {
  id: string
  name: string
  size: number
  type: string
  lastModified: number
}

// 文件上传项接口
export interface FileUploadItem extends BaseFileInfo {
  status: UploadStatus
  progress: number
  error?: string
  uploadedSize: number
  totalSize: number
  fileId?: string
  relativePath?: string
  chunkCount?: number
  uploadedChunks?: Set<number>
  abortController?: AbortController
}

// 文件夹上传项接口
export interface FolderUploadItem extends FileUploadItem {
  relativePath: string
  file: File
  fileId?: string
}

// 分片信息接口
export interface ChunkInfo {
  index: number
  hash: string
  size: number
  uploaded: boolean
  blob?: Blob
}

// 上传任务接口
export interface UploadTask {
  fileId: string
  fileName: string
  fileSize: number
  chunks: ChunkInfo[]
  uploadedChunks: Set<number>
  totalChunks: number
  status: UploadStatus
  progress: number
  abortController?: AbortController
  startTime: number
  endTime?: number
  speed?: number
  remainingTime?: string
}

// 批量上传任务接口
export interface BatchUploadTask {
  batchId: string
  uploadToken: string
  libraryId: number
  fileMappings: Record<string, string>
  maxConcurrent: number
  chunkSize: number
  wsEndpoint: string
  items: FolderUploadItem[]
  status: FolderUploadStatus
  overallProgress: number
  startTime: number
  endTime?: number
  totalFiles: number
  totalSize: number
  completedFiles: number
  failedFiles: number
}

// 上传选项接口
export interface UploadOptions {
  onProgress?: (progress: number, speed?: number) => void
  onSuccess?: (result: any) => void
  onError?: (error: any) => void
  onChunkUploaded?: (chunkIndex: number) => void
  maxConcurrent?: number
  retryTimes?: number
  chunkSize?: number
  enableResume?: boolean
  showProgress?: boolean
  showSpeed?: boolean
  showRemainingTime?: boolean
}

// 文件夹上传选项接口
export interface FolderUploadOptions extends UploadOptions {
  libraryId: number
  basePath?: string
  onItemComplete?: (item: FolderUploadItem) => void
  onItemError?: (item: FolderUploadItem, error: Error) => void
  onComplete?: (task: BatchUploadTask) => void
}

// 分片上传选项接口
export interface ChunkUploadOptions extends UploadOptions {
  onChunkComplete?: (chunkIndex: number, chunk: ChunkInfo) => void
  onChunkError?: (chunkIndex: number, error: Error) => void
  onMergeStart?: () => void
  onMergeComplete?: (result: any) => void
  onMergeError?: (error: Error) => void
}

// 上传进度接口
export interface UploadProgress {
  current: number
  total: number
  progress: number
  uploadedBytes: number
  totalBytes: number
  speed?: number
  remainingTime?: string
}

// 分片上传进度接口
export interface ChunkUploadProgress extends UploadProgress {
  currentChunk: number
  totalChunks: number
  chunkProgress: number
  uploadedChunks: number[]
}

// 上传响应接口
export interface UploadResponse {
  success: boolean
  message?: string
  data?: any
  error?: string
  errorCode?: string
}

// 分片上传响应接口
export interface ChunkUploadResponse extends UploadResponse {
  uploadedChunks?: number[]
  fileUrl?: string
  needMerge?: boolean
  fileId?: string
}

// 文件验证结果接口
export interface FileValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// 上传配置接口
export interface UploadConfig {
  // 基础配置
  chunkSize: number
  maxConcurrent: number
  retryTimes: number
  timeout: number

  // 功能开关
  enableResume: boolean
  enableCompression: boolean
  enableEncryption: boolean
  enablePreview: boolean

  // 显示配置
  showProgress: boolean
  showSpeed: boolean
  showRemainingTime: boolean
  showFileList: boolean

  // 验证配置
  allowedTypes: string[]
  maxFileSize: number
  maxTotalSize: number
  maxFileCount: number
}

// 上传事件接口
export interface UploadEvent {
  type: string
  data?: any
  timestamp: number
}

// 文件选择事件接口
export interface FileSelectEvent extends UploadEvent {
  type: 'fileSelect'
  data: {
    files: File[]
    totalSize: number
    fileCount: number
  }
}

// 上传开始事件接口
export interface UploadStartEvent extends UploadEvent {
  type: 'uploadStart'
  data: {
    fileId: string
    fileName: string
    fileSize: number
  }
}

// 上传进度事件接口
export interface UploadProgressEvent extends UploadEvent {
  type: 'uploadProgress'
  data: UploadProgress
}

// 上传完成事件接口
export interface UploadCompleteEvent extends UploadEvent {
  type: 'uploadComplete'
  data: {
    fileId: string
    fileName: string
    fileUrl: string
    fileSize: number
    uploadTime: number
  }
}

// 上传错误事件接口
export interface UploadErrorEvent extends UploadEvent {
  type: 'uploadError'
  data: {
    fileId: string
    fileName: string
    error: string
    errorCode: string
  }
}

// 上传取消事件接口
export interface UploadCancelEvent extends UploadEvent {
  type: 'uploadCancel'
  data: {
    fileId: string
    fileName: string
    reason: string
  }
}

// 上传暂停事件接口
export interface UploadPauseEvent extends UploadEvent {
  type: 'uploadPause'
  data: {
    fileId: string
    fileName: string
    reason: string
  }
}

// 上传恢复事件接口
export interface UploadResumeEvent extends UploadEvent {
  type: 'uploadResume'
  data: {
    fileId: string
    fileName: string
  }
}

// 分片上传完成事件接口
export interface ChunkCompleteEvent extends UploadEvent {
  type: 'chunkComplete'
  data: {
    fileId: string
    chunkIndex: number
    chunkSize: number
    uploadedChunks: number[]
  }
}

// 文件合并事件接口
export interface FileMergeEvent extends UploadEvent {
  type: 'fileMerge'
  data: {
    fileId: string
    fileName: string
    totalChunks: number
    mergeStartTime: number
  }
}

// 文件合并完成事件接口
export interface FileMergeCompleteEvent extends UploadEvent {
  type: 'fileMergeComplete'
  data: {
    fileId: string
    fileName: string
    fileUrl: string
    mergeTime: number
  }
}

// 上传状态枚举类型
export type UploadStatus = 'waiting' | 'uploading' | 'paused' | 'completed' | 'error' | 'cancelled'

// 文件夹上传状态枚举类型
export type FolderUploadStatus = 'initializing' | 'uploading' | 'completed' | 'error' | 'cancelled'

// 上传模式枚举类型
export type UploadMode = 'single' | 'batch' | 'folder' | 'drag_drop' | 'paste'

// 上传策略枚举类型
export type UploadStrategy = 'immediate' | 'delayed' | 'scheduled' | 'manual'

// 错误码枚举类型
export type UploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_CORRUPTED'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'CONNECTION_ERROR'
  | 'SERVER_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'UPLOAD_FAILED'
  | 'CHUNK_UPLOAD_FAILED'
  | 'MERGE_FAILED'
  | 'VALIDATION_FAILED'
  | 'UNKNOWN_ERROR'
  | 'OPERATION_CANCELLED'
  | 'INVALID_PARAMETER'

// 上传事件联合类型
export type UploadEventUnion =
  | FileSelectEvent
  | UploadStartEvent
  | UploadProgressEvent
  | UploadCompleteEvent
  | UploadErrorEvent
  | UploadCancelEvent
  | UploadPauseEvent
  | UploadResumeEvent
  | ChunkCompleteEvent
  | FileMergeEvent
  | FileMergeCompleteEvent

// 上传回调函数类型
export type UploadProgressCallback = (progress: number, speed?: number) => void
export type UploadSuccessCallback = (result: any) => void
export type UploadErrorCallback = (error: any) => void
export type UploadChunkCallback = (chunkIndex: number) => void
export type UploadItemCallback = (item: FolderUploadItem) => void
export type UploadTaskCallback = (task: BatchUploadTask) => void

// 文件验证函数类型
export type FileValidator = (file: File) => FileValidationResult | Promise<FileValidationResult>

// 文件处理器函数类型
export type FileProcessor = (file: File) => File | Promise<File>

// 上传拦截器类型
export interface UploadInterceptor {
  beforeUpload?: (file: File) => File | Promise<File> | boolean
  afterUpload?: (result: any) => any
  onError?: (error: any) => void
}

// 上传管理器接口
export interface UploadManager {
  // 基础方法
  addFile(file: File): string
  removeFile(fileId: string): boolean
  getFile(fileId: string): FileUploadItem | undefined
  getAllFiles(): FileUploadItem[]

  // 上传控制
  startUpload(fileId: string, options?: UploadOptions): Promise<void>
  pauseUpload(fileId: string): void
  resumeUpload(fileId: string): void
  cancelUpload(fileId: string): void

  // 批量操作
  startAll(options?: UploadOptions): Promise<void>
  pauseAll(): void
  resumeAll(): void
  cancelAll(): void

  // 事件监听
  on(event: string, callback: Function): void
  off(event: string, callback: Function): void
  emit(event: string, data?: any): void

  // 状态查询
  getStatus(): {
    total: number
    waiting: number
    uploading: number
    completed: number
    error: number
    cancelled: number
  }

  // 清理
  clear(): void
  cleanup(): void
}
