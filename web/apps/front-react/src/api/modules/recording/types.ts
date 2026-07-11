/**
 * 录音 API 类型定义
 * 对齐 mine-audio.md 接口规范
 */

// ============= 基础类型 =============

/** 录音任务状态 */
export type RecordingJobStatus =
  | 'recording'    // 录音中
  | 'paused'       // 已暂停
  | 'finalizing'   // 处理中（正在合并分段）
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'interrupted'  // 已中断

/** 状态切换动作 */
export type RecordingStateAction =
  | 'pause'      // 暂停
  | 'resume'     // 继续
  | 'interrupt'  // 中断（放弃）
  | 'stop'       // 停止（正常结束但不合并）

/** 录音来源类型 */
export type RecordingOriginType =
  | 'recording_audio'     // 录音生成的音频文件
  | 'recording_folder'    // 录音过程中创建的文件夹
  | 'recording_imported'  // 导入的外部音频文件

/** 录音来源渠道 */
export type RecordingOriginSource =
  | 'recording'        // 录音
  | 'recording_import' // 导入

// ============= 录音任务 =============

/** 录音任务 */
export interface RecordingJob {
  id: string
  status: RecordingJobStatus
  title: string
  library_id: string
  target_format: string
  segment_count: number
  uploaded_segment_count: number
  total_recorded_ms: number
  output_file_id: number
  started_at?: number
  ended_at?: number
  last_error: string
  last_active_at?: number
  recovery_state: 'ready' | 'recovering' | 'failed' | null
  recovery_error: string | null
  uploaded_recorded_ms: number
  upload_interval_ms: number

}

// ============= API 响应结构 =============

/** 通用 API 响应 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/** 任务响应（data.job 包裹） */
export interface JobResponse {
  job: RecordingJob | null
}

/** 分段上传响应 */
export interface SegmentUploadResponse {
  segment_id: number
  job: RecordingJob
}

/** 缺失分段响应 */
export interface MissingSegmentsResponse {
  job_id: string
  missing_count: number
  missing_segments: number[] | null
}

/** 结束录音响应 */
export interface FinalizeResponse {
  job_id: string
  output_file_id: number
}

// ============= FFmpeg 健康检查 =============

/** FFmpeg 健康检查响应 */
export interface FfmpegHealthResponse {
  available: boolean
  error?: string
}

/** 系统状态响应 */
export interface SystemStatusResponse {
  ffmpeg_available: boolean
  ffmpeg_error: string
  max_segments: number
  max_total_size_mb: number
  source_format: string
  default_format: string
}

// ============= 请求类型 =============

/** 创建录音任务请求 */
export interface CreateRecordingRequest {
  library_id: string | number  // 支持字符串 HashID 或数字
  title?: string
  target_format?: string      // 默认 'm4a'
  source_mime_type?: string   // 默认 'audio/webm'
  upload_interval_ms?: number // 默认 3000
  max_duration_ms?: number    // 默认 28800000 (8小时)
}

/** 状态切换请求 */
export interface UpdateStateRequest {
  action: RecordingStateAction
}

/** 分段上传请求（FormData 格式，用于 multipart/form-data） */
export interface UploadSegmentRequest {
  job_id: string
  segment: Blob               // 音频分段文件
  segment_index: number       // 分段序号（从 0 开始）
  duration_ms?: number        // 本段时长(ms)
  start_offset_ms?: number    // 相对开始偏移
  end_offset_ms?: number      // 相对结束偏移
  is_final_segment?: boolean  // 是否最后一段
}

// ============= 录音文件管理 =============

/** 录音文件项 */
export interface RecordingFileItem {
  id: number
  path: string
  type: 0 | 1  // 0=文件夹, 1=文件
  origin_type: RecordingOriginType
  origin_source: RecordingOriginSource
  origin_ref_id?: number
  created_time: number
  updated_time: number
  is_favorite: boolean
}

/** 录音列表响应 */
export interface RecordingsResponse {
  count: number
  data: RecordingFileItem[]
}

/** 录音列表请求参数 */
export interface GetRecordingsParams {
  type: 'dir' | 'file'
  path?: string
  keyword?: string
  offset?: number
  limit?: number
}

/** 创建文件夹请求 */
export interface CreateFolderRequest {
  path: string
}

/** 创建文件夹响应 */
export interface CreateFolderResponse {
  folder: {
    id: number
    path: string
    type: 0
    origin_type: 'recording_folder'
    origin_source: 'recording'
    origin_ref_id: number
  }
}

/** 重命名文件夹请求 */
export interface RenameFolderRequest {
  path: string
}

/** 重命名文件夹响应 */
export interface RenameFolderResponse {
  folder: {
    id: number
    path: string
  }
}

/** 导入音频文件结构项 */
export interface ImportFileStructureItem {
  relative_path: string
  size: number
  is_directory?: boolean
  parent_path?: string
  depth?: number
}

/** 导入音频请求 */
export interface ImportAudioRequest {
  library_id: string | number  // 支持字符串 HashID 或数字
  base_path?: string
  total_files: number
  total_size: number
  file_structure: ImportFileStructureItem[]
  origin_type?: RecordingOriginType
  origin_source?: RecordingOriginSource
  origin_ref_id?: number
}

/** 导入音频响应 */
export interface ImportAudioResponse {
  batch_id: string
  upload_token: string
  max_concurrent: number
  chunk_size: number
  file_mappings: Record<string, string>
  duplicate_files: string[]
}

/** 录音配置 */
export interface RecordingConfig {
  enabled: boolean
  parser_platform: string
}

// ============= 错误码 =============

/** 录音相关错误码 */
export const RECORDING_ERROR_CODES = {
  SEGMENT_PROCESSING: 100401,  // 分段正在处理中，请稍后重试
  NO_ACTIVE_JOB: 100402,       // 当前没有活跃录音任务
  ALREADY_HAS_JOB: 100403,     // 用户已有活跃录音任务
  JOB_NOT_FOUND: 100404,       // 录音任务不存在
  INVALID_STATE: 100405,       // 任务状态不允许该操作
  SEGMENT_MISSING: 100406,     // 分段序号缺失或不连续
  FFMPEG_UNAVAILABLE: 100407,  // FFmpeg 不可用
  FORMAT_UNSUPPORTED: 100408,  // 文件格式不支持
  SIZE_EXCEEDED: 100409,       // 文件大小超出限制
  DURATION_EXCEEDED: 100410,   // 录音时长超出限制
} as const