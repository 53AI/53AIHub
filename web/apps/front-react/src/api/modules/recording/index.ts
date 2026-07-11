/**
 * 录音 API 模块
 * 对齐 mine-audio.md 接口规范
 */

import request from '../../index'
import type {
  ApiResponse,
  JobResponse,
  RecordingJob,
  CreateRecordingRequest,
  UpdateStateRequest,
  UploadSegmentRequest,
  SegmentUploadResponse,
  MissingSegmentsResponse,
  FinalizeResponse,
  FfmpegHealthResponse,
  SystemStatusResponse,
  RecordingsResponse,
  GetRecordingsParams,
  CreateFolderRequest,
  CreateFolderResponse,
  RenameFolderRequest,
  RenameFolderResponse,
  ImportAudioRequest,
  ImportAudioResponse,
  RecordingConfig,
} from './types'

// ============= FFmpeg 健康检查 =============

/**
 * 获取录音配置（前台）
 * GET /api/recordings/config
 */
export async function getConfig(): Promise<RecordingConfig> {
  const res = await request.get<ApiResponse<RecordingConfig>>('/api/recordings/config')
  return res.data
}

/**
 * FFmpeg 健康检查
 * GET /api/recordings/ffmpeg-health
 */
export async function getFfmpegHealth(): Promise<FfmpegHealthResponse> {
  const res = await request.get<ApiResponse<FfmpegHealthResponse>>('/api/recordings/ffmpeg-health')
  return res.data
}

/**
 * 获取系统状态
 * GET /api/recordings/system-status
 */
export async function getSystemStatus(): Promise<SystemStatusResponse> {
  const res = await request.get<ApiResponse<SystemStatusResponse>>('/api/recordings/system-status')
  return res.data
}

// ============= 录音任务生命周期 =============

/**
 * 创建录音任务
 * POST /api/recordings
 */
export async function createRecording(data: CreateRecordingRequest): Promise<RecordingJob> {
  const res = await request.post<ApiResponse<JobResponse>>('/api/recordings', data)
  return res.data.job!
}

/**
 * 获取活跃录音任务
 * GET /api/recordings/active
 */
export async function getActiveRecording(): Promise<RecordingJob | null> {
  const res = await request.get<ApiResponse<JobResponse>>('/api/recordings/active', {  requiresAuth: true })
  return res.data.job
}

/**
 * 获取录音任务详情
 * GET /api/recordings/{job_id}
 */
export async function getRecordingById(jobId: string): Promise<RecordingJob> {
  const res = await request.get<ApiResponse<JobResponse>>(`/api/recordings/${jobId}`)
  return res.data.job!
}

/**
 * 更新录音任务状态（暂停/继续/中断/停止）
 * PATCH /api/recordings/{job_id}/state
 */
export async function updateRecordingState(
  jobId: string,
  action: UpdateStateRequest['action']
): Promise<RecordingJob> {
  const res = await request.patch<ApiResponse<JobResponse>>(`/api/recordings/${jobId}/state`, { action })
  return res.data.job!
}

/**
 * 发送心跳
 * POST /api/recordings/{job_id}/heartbeat
 */
export async function sendHeartbeat(jobId: string): Promise<RecordingJob> {
  const res = await request.post<ApiResponse<JobResponse>>(`/api/recordings/${jobId}/heartbeat`)
  return res.data.job!
}

// ============= 分段上传 =============

/**
 * 上传录音分段
 * POST /api/recordings/{job_id}/segments
 * 使用 multipart/form-data 格式
 */
export async function uploadSegment(data: UploadSegmentRequest): Promise<SegmentUploadResponse> {
  const formData = new FormData()
  formData.append('segment', data.segment, `segment_${data.segment_index}.webm`)
  formData.append('segment_index', String(data.segment_index))
  if (data.duration_ms !== undefined) {
    formData.append('duration_ms', String(data.duration_ms))
  }
  if (data.start_offset_ms !== undefined) {
    formData.append('start_offset_ms', String(data.start_offset_ms))
  }
  if (data.end_offset_ms !== undefined) {
    formData.append('end_offset_ms', String(data.end_offset_ms))
  }
  if (data.is_final_segment !== undefined) {
    formData.append('is_final_segment', String(data.is_final_segment))
  }

  const res = await request.post<ApiResponse<SegmentUploadResponse>>(
    `/api/recordings/${data.job_id}/segments`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  )
  return res.data
}

/**
 * 获取缺失的分段索引
 * GET /api/recordings/{job_id}/segments/missing
 */
export async function getMissingSegments(jobId: string): Promise<MissingSegmentsResponse> {
  const res = await request.get<ApiResponse<MissingSegmentsResponse>>(
    `/api/recordings/${jobId}/segments/missing`
  )
  return res.data
}

/**
 * 结束录音（合并分段生成最终文件）
 * POST /api/recordings/{job_id}/finalize
 * 注意：返回格式已更新，不再返回 job 对象
 */
export async function finalizeRecording(jobId: string): Promise<FinalizeResponse> {
  const res = await request.post<ApiResponse<FinalizeResponse>>(`/api/recordings/${jobId}/finalize`)
  return res.data
}

// ============= 录音文件管理 =============

/**
 * 获取录音文件/文件夹列表
 * GET /api/my-space/recordings
 */
export async function getRecordings(params: GetRecordingsParams): Promise<RecordingsResponse> {
  const res = await request.get<ApiResponse<RecordingsResponse>>('/api/my-space/recordings', { params })
  return res.data
}

/**
 * 创建录音文件夹
 * POST /api/my-space/recordings/folders
 */
export async function createRecordingFolder(
  data: CreateFolderRequest
): Promise<CreateFolderResponse> {
  const res = await request.post<ApiResponse<CreateFolderResponse>>('/api/my-space/recordings/folders', data)
  return res.data
}

/**
 * 重命名录音文件夹
 * PUT /api/my-space/recordings/folders/{folder_id}/rename
 */
export async function renameRecordingFolder(
  folderId: number,
  data: RenameFolderRequest
): Promise<RenameFolderResponse> {
  const res = await request.put<ApiResponse<RenameFolderResponse>>(
    `/api/my-space/recordings/folders/${folderId}/rename`,
    data
  )
  return res.data
}

/**
 * 导入音频文件
 * POST /api/my-space/recordings/import
 */
export async function importAudio(data: ImportAudioRequest): Promise<ImportAudioResponse> {
  const res = await request.post<ApiResponse<ImportAudioResponse>>('/api/my-space/recordings/import', data)
  return res.data
}

// ============= 默认导出 =============

export const recordingApi = {
  // 配置
  getConfig,

  // FFmpeg
  getFfmpegHealth,
  getSystemStatus,

  // 任务生命周期
  create: createRecording,
  getActive: getActiveRecording,
  getById: getRecordingById,
  updateState: updateRecordingState,
  heartbeat: sendHeartbeat,

  // 分段上传
  uploadSegment,
  getMissingSegments,
  finalize: finalizeRecording,

  // 文件管理
  getRecordings,
  createFolder: createRecordingFolder,
  renameFolder: renameRecordingFolder,
  importAudio,
}

export default recordingApi
