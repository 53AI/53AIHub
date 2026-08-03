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
  RecordingSummaryTemplate,
  RecordingFileSummary,
  FileParseStatus,
  QueuedCountResponse,
  RecordingFileInsightPage,
  FileTranscriptionResponse,
  PipelineResult,
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

// ============= 总结模板 =============

/**
 * 获取总结模板列表
 * GET /api/recordings/templates
 */
export async function getTemplates(params?: { group_id?: number }): Promise<RecordingSummaryTemplate[]> {
  const res = await request.get<ApiResponse<RecordingSummaryTemplate[]>>('/api/recordings/templates', { params })
  return res.data
}

/**
 * 对文件生成总结
 * POST /api/recordings/files/{file_id}/summarize?template_id={template_id}
 */
export async function createFileSummary(fileId: string, templateId: string): Promise<RecordingFileSummary> {
  const res = await request.post<ApiResponse<RecordingFileSummary>>(
    `/api/recordings/files/${fileId}/summarize`,
    null,
    { params: { template_id: templateId } },
  )
  return res.data
}

/**
 * 获取文件总结列表
 * GET /api/recordings/files/{file_id}/summaries
 */
export async function getFileSummaries(fileId: string): Promise<RecordingFileSummary[]> {
  const res = await request.get<ApiResponse<RecordingFileSummary[]>>(`/api/recordings/files/${fileId}/summaries`)
  return res.data
}

/**
 * 获取单条总结详情
 * GET /api/recordings/summaries/{summary_id}
 */
export async function getSummaryDetail(summaryId: string): Promise<RecordingFileSummary> {
  const res = await request.get<ApiResponse<RecordingFileSummary>>(`/api/recordings/summaries/${summaryId}`)
  return res.data
}

/**
 * 删除总结
 * DELETE /api/recordings/summaries/{summary_id}
 */
export async function deleteSummary(summaryId: string): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/summaries/${summaryId}`)
}

// ============= 解析状态 =============

/**
 * 获取文件解析状态
 * GET /api/recordings/files/{file_id}/parse-status
 */
export async function getParseStatus(fileId: string): Promise<FileParseStatus> {
  const res = await request.get<ApiResponse<FileParseStatus>>(`/api/recordings/files/${fileId}/parse-status`)
  return res.data
}

// ============= 排队文件数 =============

/**
 * 获取当前用户排队中的文件数
 * GET /api/recordings/my-queued-count
 */
export async function getMyQueuedCount(): Promise<QueuedCountResponse> {
  const res = await request.get<ApiResponse<QueuedCountResponse>>('/api/recordings/my-queued-count')
  return res.data
}

// ============= 决策页面编排 =============

/**
 * 获取编排后的决策页面数据
 * GET /api/recordings/files/{file_id}/insight-page
 */
export async function getInsightPage(fileId: string): Promise<RecordingFileInsightPage | null> {
  const res = await request.get<ApiResponse<RecordingFileInsightPage | null>>(`/api/recordings/files/${fileId}/insight-page`)
  return res.data
}

// ============= 转写原文 =============

/**
 * 获取录音文件转写原文
 * GET /api/recordings/files/{file_id}/transcription
 */
export async function getTranscription(fileId: string): Promise<FileTranscriptionResponse | null> {
  const res = await request.get<ApiResponse<FileTranscriptionResponse | null>>(`/api/recordings/files/${fileId}/transcription`)
  return res.data
}

// ============= 继续生成管线 🆕 =============

/**
 * 继续生成管线（补跑纪要/洞察/页面编排，不重新转写）
 * POST /api/recordings/files/{file_id}/pipeline
 * 返回 200 表示全跳过，202 表示有步骤正在处理
 */
export async function pipeline(fileId: string): Promise<PipelineResult> {
  const res = await request.post<ApiResponse<PipelineResult>>(`/api/recordings/files/${fileId}/pipeline`)
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

  // 总结模板
  getTemplates,
  createFileSummary,
  getFileSummaries,
  getSummaryDetail,
  deleteSummary,

  // 解析状态
  getParseStatus,

  // 排队文件数
  getMyQueuedCount,

  // 决策页面编排
  getInsightPage,
  getTranscription,

  // 继续生成管线
  pipeline,
}

export default recordingApi
