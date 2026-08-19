/**
 * 录音 API 模块
 * 对齐 mine-audio.md 接口规范
 */

import request, { get as getRequest, post as postRequest } from '../../index'
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
  InsightBackground,
  InsightWorkshopChatRequest,
  InsightWorkshopChatResponse,
  InsightConversationMessage,
  FileTranscriptionResponse,
  TranscriptionExportResponse,
  PipelineResult,
  MoveFileToGroupRequest,
  MoveFileToGroupResponse,
  RecordingMemoryOverview,
  RecordingMemoryEntityList,
  RecordingMemoryEntityDetail,
  RecordingMemoryEntitySchemas,
  UpdateRecordingMemoryEntityRequest,
  RecordingShareCreateResponse,
  RecordingSharedContent,
  RecordingDeviceConfig,
  RecordingDeviceConfigUpdate,
  RecordingDeviceStatusResponse,
  RecordingDeviceType,
  SyncSonicNoteRequest,
  SyncSonicNoteResponse,
  SyncStatusResponse,
} from './types'

/**
 * 断言业务码为成功
 *
 * 全局响应拦截器只对 FORBIDDEN 做 reject，其余非 0 业务码都会当成功返回，
 * 分享相关接口的"分享不存在"是 HTTP 200 + code 404，必须在这里显式拦下来，
 * 否则调用方会拿到 data = undefined 却以为请求成功。
 */
function assertOk<T>(res: ApiResponse<T>, fallbackMessage: string): T {
  if (res?.code !== 0) {
    const error = new Error(res?.message || fallbackMessage)
    ;(error as Error & { code?: number }).code = res?.code
    throw error
  }
  return res.data
}

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

/**
 * 获取当前用户的会议记忆总览
 * GET /api/recordings/memories/overview
 */
export async function getMemoryOverview(params: {
  kind?: string
  keyword?: string
  limit?: number
} = {}): Promise<RecordingMemoryOverview> {
  const res = await request.get<ApiResponse<RecordingMemoryOverview>>('/api/recordings/memories/overview', {
    params,
  })
  return res.data
}

/** 获取安心录实体记忆列表。 */
export async function getMemoryEntities(params: {
  entity_type?: string
  keyword?: string
  limit?: number
  offset?: number
} = {}): Promise<RecordingMemoryEntityList> {
  const res = await request.get<ApiResponse<RecordingMemoryEntityList>>('/api/recordings/memories/entities', { params })
  return res.data
}

/**
 * 获取会议记忆实体 schema（进入页面时拉一次缓存）。
 * 中文名/枚举值全部来源于此接口，前端不硬编码。
 */
export async function getMemorySchema(): Promise<RecordingMemoryEntitySchemas> {
  const res = await request.get<ApiResponse<RecordingMemoryEntitySchemas>>('/api/recordings/memories/schema')
  return res.data
}

/** 获取一条安心录实体记忆的属性、事实时间线和关联。 */
export async function getMemoryEntity(entityId: string | number): Promise<RecordingMemoryEntityDetail> {
  const res = await request.get<ApiResponse<RecordingMemoryEntityDetail>>(`/api/recordings/memories/entities/${entityId}`)
  return res.data
}

export async function updateMemoryEntity(entityId: string | number, data: UpdateRecordingMemoryEntityRequest): Promise<RecordingMemoryEntityDetail> {
  const res = await request.patch<ApiResponse<RecordingMemoryEntityDetail>>(`/api/recordings/memories/entities/${entityId}`, data)
  return res.data
}

export async function addMemoryEntityFact(entityId: string | number, data: { content: string; attributes?: Record<string, string> }): Promise<RecordingMemoryEntityDetail> {
  const res = await request.post<ApiResponse<RecordingMemoryEntityDetail>>(`/api/recordings/memories/entities/${entityId}/facts`, data)
  return res.data
}

export async function deleteMemoryEntityFact(entityId: string | number, factId: string | number): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/memories/entities/${entityId}/facts/${factId}`)
}

export async function deleteMemoryEntity(entityId: string | number): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/memories/entities/${entityId}`)
}

export async function mergeMemoryEntities(sourceId: string | number, targetId: string | number): Promise<RecordingMemoryEntityDetail> {
  const res = await request.post<ApiResponse<RecordingMemoryEntityDetail>>('/api/recordings/memories/entity-merges', { source_id: String(sourceId), target_id: String(targetId) })
  return res.data
}

export async function addMemoryEntityRelation(entityId: string | number, relatedEntityId: string | number): Promise<RecordingMemoryEntityDetail> {
  const res = await request.post<ApiResponse<RecordingMemoryEntityDetail>>(`/api/recordings/memories/entities/${entityId}/relations`, { related_entity_id: String(relatedEntityId) })
  return res.data
}

export async function deleteMemoryEntityRelation(entityId: string | number, relationId: string | number): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/memories/entities/${entityId}/relations/${relationId}`)
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

/**
 * 获取洞察协同研讨背景
 * GET /api/recordings/files/{file_id}/insight-context
 */
export async function getInsightBackground(fileId: string): Promise<InsightBackground> {
  return getRequest<InsightBackground>(`/api/recordings/files/${fileId}/insight-context`)
}

/**
 * 发送洞察背景协同对话
 * POST /api/recordings/files/{file_id}/insight-context/chat
 */
export async function chatInsightWorkshop(
  fileId: string,
  data: InsightWorkshopChatRequest,
): Promise<InsightWorkshopChatResponse> {
  return postRequest<InsightWorkshopChatResponse>(
    `/api/recordings/files/${fileId}/insight-context/chat`,
    data,
  )
}

/**
 * 带补充背景重新生成洞察
 * POST /api/recordings/files/{file_id}/insights/regenerate
 */
export async function regenerateInsights(
  fileId: string,
  data: { background: InsightBackground; conversation: InsightConversationMessage[] },
): Promise<void> {
  await postRequest<{ ok: boolean }>(`/api/recordings/files/${fileId}/insights/regenerate`, data)
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

/**
 * 导出转写（后端把 DashScope 转写 JSON 渲染为 Markdown 直接返回，不是文件下载）
 * GET /api/recordings/files/{file_id}/transcription/export
 */
export async function exportTranscription(fileId: string): Promise<TranscriptionExportResponse> {
  const res = await request.get<ApiResponse<TranscriptionExportResponse>>(`/api/recordings/files/${fileId}/transcription/export`)
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

// ============= 移动文件到分组 🆕 =============

/**
 * 移动文件到分组（移入或移出分组）
 * PUT /api/recordings/files/{file_id}/group
 * group_id = 0 表示移出分组（未分组）
 */
export async function moveFileToGroup(
  fileId: string,
  data: MoveFileToGroupRequest,
): Promise<MoveFileToGroupResponse> {
  const res = await request.put<ApiResponse<MoveFileToGroupResponse>>(
    `/api/recordings/files/${fileId}/group`,
    data,
  )
  return res.data
}

// ============= 录音分享 🆕 =============

/**
 * 创建录音分享
 * POST /api/recordings/files/{file_id}/share
 *
 * 分享链接永久有效，本迭代无有效期与取消接口；重复调用由后端决定是否复用同一 share_id。
 */
export async function createFileShare(fileId: string): Promise<RecordingShareCreateResponse> {
  const res = await request.post<ApiResponse<RecordingShareCreateResponse>>(
    `/api/recordings/files/${fileId}/share`,
  )
  return assertOk(res, '创建分享失败')
}

/**
 * 获取分享内容（匿名，无需登录）
 * GET /api/recordings/shared/{share_id}
 *
 * 分享不存在时后端返回 HTTP 200 + code 404，由 assertOk 转成 reject。
 */
export async function getSharedRecording(shareId: string): Promise<RecordingSharedContent> {
  const res = await request.get<ApiResponse<RecordingSharedContent>>(
    `/api/recordings/shared/${shareId}`,
  )
  return assertOk(res, '分享不存在')
}

// ============= SonicNote 设备与同步 🆕 =============

/**
 * 获取当前用户的设备配置（含 api_key 明文）
 * GET /api/recordings/devices
 *
 * 注意：后端对当前登录用户自己的 api_key 不做脱敏，需完整回填到前端。
 * 未配置过的设备类型不会出现在返回列表中。
 */
export async function getDevices(): Promise<RecordingDeviceConfig[]> {
  const res = await request.get<ApiResponse<RecordingDeviceConfig[]>>('/api/recordings/devices')
  return res.data
}

/**
 * 保存当前用户的设备配置
 * PUT /api/recordings/devices
 *
 * - api_key 传空字符串表示"保留原值"；传具体值则覆盖
 * - enabled 单独切换，不影响 api_key
 */
export async function putDevice(data: RecordingDeviceConfigUpdate): Promise<void> {
  await request.put<ApiResponse<void>>('/api/recordings/devices', data)
}

/**
 * 实时探测设备是否可用（不缓存）
 * GET /api/recordings/devices/{device_type}/status
 *
 * 同步设置页在绑定 Key 后 / 同步前调用，验证 SonicNote Key 有效性与账号数据量。
 *
 * 失败语义：
 * - HTTP 200 + code 0 + available=false：业务上的"不可用"，由 reason 字段说明原因
 *   （key_invalid / network_error / 设备未启用 / 探测失败: <详情>）
 * - HTTP 失败 / code !== 0：真正的网络/服务异常，axios reject，调用方 catch
 */
export async function getDeviceStatus(deviceType: RecordingDeviceType): Promise<RecordingDeviceStatusResponse> {
  const res = await request.get<ApiResponse<RecordingDeviceStatusResponse>>(
    `/api/recordings/devices/${deviceType}/status`,
  )
  return res.data
}

/**
 * 触发 SonicNote 同步（异步，立即返回 job_id）
 * POST /api/recordings/sync-sonicnote
 *
 * 防重入：已有同步任务进行中时后端返回 code=4；使用 assertOk 把非 0 业务码
 * 转成带 .code 的 Error，调用方 catch 后按 code 分支处理。
 * 等 sync-status 返回终态后再允许下一次触发。
 */
export async function syncSonicNote(data: SyncSonicNoteRequest = {}): Promise<SyncSonicNoteResponse> {
  const res = await request.post<ApiResponse<SyncSonicNoteResponse>>('/api/recordings/sync-sonicnote', data)
  return assertOk(res, '触发同步失败')
}

/**
 * 轮询同步任务状态（直至终态 completed/failed/interrupted）
 * GET /api/recordings/sync-status
 *
 * 后端无任务时返回的 data 通常为 null（或空对象），由调用方按需判断。
 *
 * 适配点（对齐后端实测响应）：
 * - 后端字段 id / completed / error → 前端约定 job_id / imported / error_message
 * - finished_at=0 表示进行中 → null（前端约定）
 *
 * 适配放在 API 层，避免污染调用端的字段名 / 语义。
 */
export async function getSyncStatus(): Promise<SyncStatusResponse | null> {
  const res = await request.get<ApiResponse<Record<string, any> | null>>('/api/recordings/sync-status')
  const d = res?.data
  if (!d) return null
  return {
    job_id: d.id,
    status: d.status,
    started_at: d.started_at,
    // 后端无 finished_at 或 =0 均视为进行中，前端约定统一为 null
    finished_at: d.finished_at && d.finished_at !== 0 ? d.finished_at : null,
    discovered: d.discovered ?? 0,
    imported: d.completed ?? 0,
    skipped: d.skipped ?? 0,
    failed: d.failed ?? 0,
    error_message: d.error || undefined,
  }
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
  getMemoryOverview,
  getMemoryEntities,
  getMemorySchema,
  getMemoryEntity,
  updateMemoryEntity,
  addMemoryEntityFact,
  deleteMemoryEntityFact,
  deleteMemoryEntity,
  mergeMemoryEntities,
  addMemoryEntityRelation,
  deleteMemoryEntityRelation,

  // 决策页面编排
  getInsightPage,
  getInsightBackground,
  chatInsightWorkshop,
  regenerateInsights,
  getTranscription,
  exportTranscription,

  // 继续生成管线
  pipeline,

  // 移动文件到分组
  moveFileToGroup,

  // 分享
  createFileShare,
  getSharedRecording,

  // SonicNote 设备与同步
  getDevices,
  putDevice,
  getDeviceStatus,
  syncSonicNote,
  getSyncStatus,
}

export default recordingApi
