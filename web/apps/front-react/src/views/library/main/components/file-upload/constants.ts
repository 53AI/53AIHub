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

// 文件大小限制常量
export const FILE_SIZE_LIMITS = {
  // 默认分片大小 (5MB)
  DEFAULT_CHUNK_SIZE: 5 * 1024 * 1024,
  // 最大分片大小 (10MB)
  MAX_CHUNK_SIZE: 10 * 1024 * 1024,
  // 最小分片大小 (1MB)
  MIN_CHUNK_SIZE: 1 * 1024 * 1024,
  // 单文件最大大小 (2GB)
  MAX_SINGLE_FILE_SIZE: 2 * 1024 * 1024 * 1024,
  // 批量上传最大文件数
  MAX_BATCH_FILES: 1000,
  // 批量上传最大总大小 (10GB)
  MAX_BATCH_TOTAL_SIZE: 10 * 1024 * 1024 * 1024
} as const

// 上传配置常量
export const UPLOAD_CONFIG = {
  // 默认并发数
  DEFAULT_MAX_CONCURRENT: 3,
  // 最大并发数
  MAX_CONCURRENT: 10,
  // 最小并发数
  MIN_CONCURRENT: 1,
  // 默认重试次数
  DEFAULT_RETRY_TIMES: 3,
  // 最大重试次数
  MAX_RETRY_TIMES: 10,
  // 重试延迟基数 (毫秒)
  RETRY_DELAY_BASE: 1000,
  // 进度更新间隔 (毫秒)
  PROGRESS_UPDATE_INTERVAL: 200,
  // WebSocket 重连间隔 (毫秒)
  WS_RECONNECT_INTERVAL: 3000,
  // 心跳间隔 (毫秒)
  HEARTBEAT_INTERVAL: 30000
} as const
