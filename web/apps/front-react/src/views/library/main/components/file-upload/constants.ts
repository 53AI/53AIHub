/**
 * 上传相关常量定义
 */

// 上传状态常量
export const UPLOAD_STATUS = {
  WAITING: 'waiting',
  UPLOADING: 'uploading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
} as const

export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS]

// 文件大小阈值
// 单文件上限全库只此一处定义（validateUploadFile 读它）；需要按扩展名放宽/收紧时
// 用 FileUpload 的 maxSize prop（单位 MB）覆盖
export const FILE_SIZE_LIMITS = {
  // 单文件大小上限 (100MB)
  MAX_SINGLE_FILE_SIZE: 100 * 1024 * 1024,
  // 分片大小 (1MB)
  MIN_CHUNK_SIZE: 1 * 1024 * 1024
} as const

// 单文件超限的统一文案：失败原因、列表行、重试提示共用同一份
export const FILE_SIZE_EXCEEDED_MESSAGE = '文件大小超过上限'

// 单次上传的文件数上限（队列总量与文件夹选择共用同一上限）
export const MAX_UPLOAD_FILES = 1000

// 上传配置常量
export const UPLOAD_CONFIG = {
  // 默认并发数
  DEFAULT_MAX_CONCURRENT: 3
} as const
