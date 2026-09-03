/**
 * 录音 API 模块
 * 对齐 mine-audio.md 接口规范
 */

import request, { get as getRequest, post as postRequest } from '../../index';
import service from '../../config';
import type { AxiosRequestConfig } from 'axios';
import { handleError } from '../../errorHandler';
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
  RecordingsResponse,
  GetRecordingsParams,
  ImportAudioRequest,
  ImportAudioResponse,
  RecordingConfig,
  RecordingSummaryTemplate,
  RecordingFileSummary,
  FileParseStatus,
  QueuedCountResponse,
  RecordingFileInsightPage,
  InsightBackground,
  InsightPerspectiveOption,
  InsightWorkshopChatRequest,
  InsightWorkshopChatResponse,
  InsightRegenerationRequest,
  FileTranscriptionResponse,
  TranscriptionExportResponse,
  PipelineResult,
  MoveFileToGroupRequest,
  MoveFileToGroupResponse,
  RecordingMemoryEntityList,
  RecordingMemoryEntityDetail,
  RecordingMemoryEntitySchemas,
  UpdateRecordingMemoryEntityRequest,
  CreateRecordingMemoryEntityRequest,
  MergeMemoryEntitiesRequest,
  RecordingShareCreateResponse,
  RecordingSharedContent,
  RecordingDeviceConfig,
  RecordingDeviceStatusResponse,
  RecordingDeviceType,
  SyncStatusResponse,
  CreateDeviceRequest,
  CreateDeviceResponse,
  UpdateDeviceByIdRequest,
  SyncDeviceRequest,
  SyncDeviceResponse,
} from './types';

/**
 * 业务错误统一交给 `handleError` 处理：
 * - HTTP 4xx/5xx：响应拦截器直接 throw，`handleError` 从 `error.response.data.{code, message}`
 *   提取并 message.warning 提示 + Promise.reject(error) 抛给调用方。
 * - HTTP 200 + code!=0：当前不拦（调用方需要的话自己处理 res.code）。
 * 因此调用方通常不要再 catch 里再 message.error，避免重复弹窗。
 *
 * 历史：本文件早期各接口未统一接 handleError，错误散落到各调用方 catch 里再 message.error，
 * 行为不一致、重复弹窗时有发生。本轮统一收口到 API 层：
 * - `service.X(...)` 直接 `.then(...).catch(handleError)`
 * - `request.X(...)` 在 await 处链 `.catch(handleError)`
 */

// ============= FFmpeg 健康检查 =============

/**
 * 获取录音配置（前台）
 * GET /api/recordings/config
 */
export async function getConfig(): Promise<RecordingConfig> {
  const res = await request.get<ApiResponse<RecordingConfig>>('/api/recordings/config').catch(handleError)
  return res.data
}

/**
 * FFmpeg 健康检查
 * GET /api/recordings/ffmpeg-health
 */
export async function getFfmpegHealth(): Promise<FfmpegHealthResponse> {
  const res = await request.get<ApiResponse<FfmpegHealthResponse>>('/api/recordings/ffmpeg-health').catch(handleError)
  return res.data
}

// ============= 录音任务生命周期 =============

/**
 * 创建录音任务
 * POST /api/recordings
 */
async function createRecording(data: CreateRecordingRequest): Promise<RecordingJob> {
  const res = await request.post<ApiResponse<JobResponse>>('/api/recordings', data).catch(handleError)
  return res.data.job!
}

/**
 * 获取活跃录音任务
 * GET /api/recordings/active
 */
async function getActiveRecording(): Promise<RecordingJob | null> {
  const res = await request.get<ApiResponse<JobResponse>>('/api/recordings/active', { requiresAuth: true }).catch(handleError)
  return res.data.job
}

/**
 * 获取录音任务详情
 * GET /api/recordings/{job_id}
 */
async function getRecordingById(jobId: string): Promise<RecordingJob> {
  const res = await request.get<ApiResponse<JobResponse>>(`/api/recordings/${jobId}`).catch(handleError)
  return res.data.job!
}

/**
 * 更新录音任务状态（暂停/继续/中断/停止）
 * PATCH /api/recordings/{job_id}/state
 */
async function updateRecordingState(
  jobId: string,
  action: UpdateStateRequest['action'],
): Promise<RecordingJob> {
  const res = await request.patch<ApiResponse<JobResponse>>(`/api/recordings/${jobId}/state`, { action }).catch(handleError)
  return res.data.job!
}

/**
 * 发送心跳
 * POST /api/recordings/{job_id}/heartbeat
 */
async function sendHeartbeat(jobId: string): Promise<RecordingJob> {
  const res = await request.post<ApiResponse<JobResponse>>(`/api/recordings/${jobId}/heartbeat`).catch(handleError)
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
    },
  ).catch(handleError)
  return res.data
}

/**
 * 获取缺失的分段索引
 * GET /api/recordings/{job_id}/segments/missing
 */
export async function getMissingSegments(jobId: string): Promise<MissingSegmentsResponse> {
  const res = await request.get<ApiResponse<MissingSegmentsResponse>>(
    `/api/recordings/${jobId}/segments/missing`,
  ).catch(handleError)
  return res.data
}

/**
 * 结束录音（合并分段生成最终文件）
 * POST /api/recordings/{job_id}/finalize
 * 注意：返回格式已更新，不再返回 job 对象
 */
async function finalizeRecording(jobId: string): Promise<FinalizeResponse> {
  const res = await request.post<ApiResponse<FinalizeResponse>>(`/api/recordings/${jobId}/finalize`).catch(handleError)
  return res.data
}

// ============= 录音文件管理 =============

/**
 * 获取录音文件/文件夹列表
 * GET /api/my-space/recordings
 */
export async function getRecordings(params: GetRecordingsParams): Promise<RecordingsResponse> {
  const res = await request.get<ApiResponse<RecordingsResponse>>('/api/my-space/recordings', { params }).catch(handleError)
  return res.data
}

/**
 * 导入音频文件
 * POST /api/my-space/recordings/import
 */
export async function importAudio(data: ImportAudioRequest): Promise<ImportAudioResponse> {
  return service
    .post('/api/my-space/recordings/import', data)
    .then((res) => res.data)
    .catch(handleError)
}

// ============= 总结模板 =============

/**
 * 获取总结模板列表
 * GET /api/recordings/templates
 */
export async function getTemplates(params?: { group_id?: number }): Promise<RecordingSummaryTemplate[]> {
  const res = await request.get<ApiResponse<RecordingSummaryTemplate[]>>('/api/recordings/templates', { params }).catch(handleError)
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
  ).catch(handleError)
  return res.data
}

/**
 * 获取文件总结列表
 * GET /api/recordings/files/{file_id}/summaries
 */
export async function getFileSummaries(fileId: string, config?: AxiosRequestConfig): Promise<RecordingFileSummary[]> {
  const res = await request.get<ApiResponse<RecordingFileSummary[]>>(`/api/recordings/files/${fileId}/summaries`, config).catch(handleError)
  return res.data
}

/**
 * 获取单条总结详情
 * GET /api/recordings/summaries/{summary_id}
 */
export async function getSummaryDetail(summaryId: string): Promise<RecordingFileSummary> {
  const res = await request.get<ApiResponse<RecordingFileSummary>>(`/api/recordings/summaries/${summaryId}`).catch(handleError)
  return res.data
}

/**
 * 删除总结
 * DELETE /api/recordings/summaries/{summary_id}
 */
export async function deleteSummary(summaryId: string): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/summaries/${summaryId}`).catch(handleError)
}

// ============= 解析状态 =============

/**
 * 获取文件解析状态
 * GET /api/recordings/files/{file_id}/parse-status
 */
export async function getParseStatus(fileId: string, config?: AxiosRequestConfig): Promise<FileParseStatus> {
  const res = await request.get<ApiResponse<FileParseStatus>>(`/api/recordings/files/${fileId}/parse-status`, config).catch(handleError)
  return res.data
}

// ============= 排队文件数 =============

/**
 * 获取当前用户排队中的文件数
 * GET /api/recordings/my-queued-count
 */
export async function getMyQueuedCount(): Promise<QueuedCountResponse> {
  const res = await request.get<ApiResponse<QueuedCountResponse>>('/api/recordings/my-queued-count').catch(handleError)
  return res.data
}

/** 获取安心录实体记忆列表。 */
export async function getMemoryEntities(params: {
  entity_type?: string
  keyword?: string
  limit?: number
  offset?: number
} = {}): Promise<RecordingMemoryEntityList> {
  const res = await request.get<ApiResponse<RecordingMemoryEntityList>>('/api/recordings/memories/entities', { params }).catch(handleError)
  return res.data
}

/**
 * 获取会议记忆实体 schema（进入页面时拉一次缓存）。
 * 中文名/枚举值全部来源于此接口，前端不硬编码。
 */
export async function getMemorySchema(): Promise<RecordingMemoryEntitySchemas> {
  const res = await request.get<ApiResponse<RecordingMemoryEntitySchemas>>('/api/recordings/memories/schema').catch(handleError)
  return res.data
}

/** 获取一条安心录实体记忆的属性、事实时间线和关联。 */
export async function getMemoryEntity(entityId: string | number): Promise<RecordingMemoryEntityDetail> {
  const res = await request.get<ApiResponse<RecordingMemoryEntityDetail>>(`/api/recordings/memories/entities/${entityId}`).catch(handleError)
  return res.data
}

/**
 * 编辑实体记忆（PATCH）。
 * 4xx 业务错误（"同类型同名已存在" / 实体不存在）由 handleError 拦截并提示。
 */
export async function updateMemoryEntity(entityId: string | number, data: UpdateRecordingMemoryEntityRequest): Promise<RecordingMemoryEntityDetail> {
  return service
    .patch(`/api/recordings/memories/entities/${entityId}`, data)
    .then((res) => res.data)
    .catch(handleError)
}

/**
 * 新增实体（POST /api/recordings/memories/entities）。
 * 4xx 业务错误（"同类型同名已存在" / entity_type 不在 schema / 实体名不能为空）
 * 由 handleError 拦截并提示。文档 §3。
 */
export async function createMemoryEntity(data: CreateRecordingMemoryEntityRequest): Promise<RecordingMemoryEntityDetail> {
  return service
    .post('/api/recordings/memories/entities', data)
    .then((res) => res.data)
    .catch(handleError)
}

export async function deleteMemoryEntity(entityId: string | number): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/memories/entities/${entityId}`).catch(handleError)
}

/**
 * 多选融合：把多条同类型实体合并到 target。
 * 优先使用 `source_ids`（多源），缺失时回退到单源 `source_id` 兼容老调用方。
 * 4xx/404（"仅支持同类型实体融合" / "基底实体不能同时作为来源实体" / "推理模型未配置" /
 * 实体不存在）由 handleError 拦截并提示。文档 §6。
 */
export async function mergeMemoryEntities(
  sourceIds: Array<string | number>,
  targetId: string | number,
): Promise<RecordingMemoryEntityDetail> {
  const payload: MergeMemoryEntitiesRequest = { target_id: String(targetId) }
  if (sourceIds.length > 1) {
    payload.source_ids = sourceIds.map((id) => String(id))
  } else if (sourceIds.length === 1) {
    payload.source_id = String(sourceIds[0])
  }
  return service
    .post('/api/recordings/memories/entity-merges', payload)
    .then((res) => res.data)
    .catch(handleError)
}

// ============= 决策页面编排 =============

/**
 * 获取编排后的决策页面数据
 * GET /api/recordings/files/{file_id}/insight-page
 */
export async function getInsightPage(fileId: string, config?: AxiosRequestConfig): Promise<RecordingFileInsightPage | null> {
  const res = await request.get<ApiResponse<RecordingFileInsightPage | null>>(`/api/recordings/files/${fileId}/insight-page`, config).catch(handleError)
  return res.data
}

/**
 * 获取洞察协同研讨背景
 * GET /api/recordings/files/{file_id}/insight-context
 */
export async function getInsightBackground(fileId: string): Promise<InsightBackground> {
  return getRequest<InsightBackground>(`/api/recordings/files/${fileId}/insight-context`).catch(handleError)
}

/** 获取洞察可选场景 */
export async function getInsightPerspectives(): Promise<InsightPerspectiveOption[]> {
  return getRequest<InsightPerspectiveOption[]>('/api/recordings/insight-perspectives').catch(handleError)
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
  ).catch(handleError)
}

/**
 * 带补充背景重新生成洞察
 * POST /api/recordings/files/{file_id}/insights/regenerate
 */
export async function regenerateInsights(
  fileId: string,
  data: InsightRegenerationRequest,
): Promise<void> {
  await postRequest<{ ok: boolean }>(`/api/recordings/files/${fileId}/insights/regenerate`, data).catch(handleError)
}

/**
 * 将当前文件已保存的“补充背景”显式升级为跨会议用户确认记忆。
 * POST /api/recordings/files/{file_id}/memory-promotions
 */
export async function promoteInsightExternalConstraints(fileId: string, externalConstraints: string): Promise<void> {
  await postRequest<{ ok: boolean }>(
    `/api/recordings/files/${fileId}/memory-promotions`,
    { external_constraints: externalConstraints },
  ).catch(handleError)
}

// ============= 转写原文 =============

/**
 * 获取录音文件转写原文
 * GET /api/recordings/files/{file_id}/transcription
 */
export async function getTranscription(fileId: string, config?: AxiosRequestConfig): Promise<FileTranscriptionResponse | null> {
  const res = await request.get<ApiResponse<FileTranscriptionResponse | null>>(`/api/recordings/files/${fileId}/transcription`, config).catch(handleError)
  return res.data
}

/**
 * 导出转写（后端把 DashScope 转写 JSON 渲染为 Markdown 直接返回，不是文件下载）
 * GET /api/recordings/files/{file_id}/transcription/export
 */
export async function exportTranscription(fileId: string): Promise<TranscriptionExportResponse> {
  const res = await request.get<ApiResponse<TranscriptionExportResponse>>(`/api/recordings/files/${fileId}/transcription/export`).catch(handleError)
  return res.data
}

// ============= 继续生成管线 🆕 =============

/**
 * 继续生成管线（补跑纪要/洞察/页面编排，不重新转写）
 * POST /api/recordings/files/{file_id}/pipeline
 * 返回 200 表示全跳过，202 表示有步骤正在处理
 */
export async function pipeline(fileId: string): Promise<PipelineResult> {
  const res = await request.post<ApiResponse<PipelineResult>>(`/api/recordings/files/${fileId}/pipeline`).catch(handleError)
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
  ).catch(handleError)
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
  return service
    .post(`/api/recordings/files/${fileId}/share`)
    .then((res) => res.data)
    .catch(handleError)
}

/**
 * 获取分享内容（匿名，无需登录）
 * GET /api/recordings/shared/{share_id}
 *
 * 注意：分享不存在若后端走 HTTP 200 + code 404，响应拦截器不会 throw，
 * 会被当成正常 data 返回。如要拦截请在调用方按需加 res.code 检查。
 */
export async function getSharedRecording(shareId: string): Promise<RecordingSharedContent> {
  return service
    .get(`/api/recordings/shared/${shareId}`)
    .then((res) => res.data)
    .catch(handleError)
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
  const res = await request.get<ApiResponse<RecordingDeviceConfig[]>>('/api/recordings/devices').catch(handleError)
  return res.data
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
 * - HTTP 失败 / code !== 0：真正的网络/服务异常，由 handleError 拦截
 */
export async function getDeviceStatus(deviceType: RecordingDeviceType): Promise<RecordingDeviceStatusResponse> {
  const res = await request.get<ApiResponse<RecordingDeviceStatusResponse>>(
    `/api/recordings/devices/${deviceType}/status`,
  ).catch(handleError)
  return res.data
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
  const res = await request.get<ApiResponse<Record<string, any> | null>>('/api/recordings/sync-status').catch(handleError)
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
    // B 组统一入口 provider（sonicnote / ticnote），用于进入页面时按 type 去重
    provider: d.provider,
  }
}

// ============= 设备管理（B 组，多 key 场景） =============

/**
 * 添加设备配置（多 key 入口）
 * POST /api/recordings/devices
 *
 * - 同企业同类型同 key 已被他人绑定 → 400「该设备 Key 已被绑定」由 handleError 拦截
 * - 用户首条配置自动 is_active=true；后续新增不自动切换激活
 */
export async function createDevice(data: CreateDeviceRequest): Promise<CreateDeviceResponse> {
  return service
    .post('/api/recordings/devices', data)
    .then((res) => res.data)
    .catch(handleError)
}

/**
 * 按 id 更新设备配置
 * PUT /api/recordings/devices/{id}
 *
 * - api_key 为空保留原值；enabled 缺省保留原值
 * - id 不存在或不属于当前用户 → 404，由 handleError 拦截
 */
export async function updateDeviceById(id: string, data: UpdateDeviceByIdRequest): Promise<void> {
  await request.put<ApiResponse<void>>(`/api/recordings/devices/${id}`, data).catch(handleError)
}

/**
 * 按 id 删除设备配置
 * DELETE /api/recordings/devices/{id}
 *
 * - id 不存在或不属于当前用户 → 404，由 handleError 拦截
 * - 删除激活设备后端不迁移激活，调用方需自行激活新设备
 */
export async function deleteDeviceById(id: string): Promise<void> {
  await request.delete<ApiResponse<void>>(`/api/recordings/devices/${id}`).catch(handleError)
}

/**
 * 设置当前激活设备
 * PUT /api/recordings/devices/{id}/active
 *
 * - 同用户其他配置自动取消激活
 * - id 不存在或不属于当前用户 → 404，由 handleError 拦截
 */
export async function setActiveDevice(id: string): Promise<void> {
  await request.put<ApiResponse<void>>(`/api/recordings/devices/${id}/active`).catch(handleError)
}

/**
 * 统一同步入口（推荐新前端使用）
 * POST /api/recordings/sync
 *
 * - device_type 必填（sonicnote / ticnote）
 * - device_id 可选：缺省同步该 type 全部启用配置（多 key 串行）
 * - HTTP 失败由 handleError 拦截。
 */
export async function syncDevice(data: SyncDeviceRequest): Promise<SyncDeviceResponse> {
  return service
    .post('/api/recordings/sync', data)
    .then((res) => res.data)
    .catch(handleError)
}

// ============= 默认导出 =============

export const recordingApi = {
  // 配置
  getConfig,

  // FFmpeg
  getFfmpegHealth,

  // 任务生命周期（命名别名映射）
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
  importAudio,

  // 总结模板
  getTemplates,
  createFileSummary,
  getFileSummaries,
  getSummaryDetail,
  deleteSummary,

  // 解析状态
  getParseStatus,

  // 排队文件数 / 实体记忆
  getMyQueuedCount,
  getMemoryEntities,
  getMemorySchema,
  getMemoryEntity,
  createMemoryEntity,
  updateMemoryEntity,
  deleteMemoryEntity,
  mergeMemoryEntities,

  // 决策页面编排
  getInsightPage,
  getInsightBackground,
  getInsightPerspectives,
  chatInsightWorkshop,
  regenerateInsights,
  promoteInsightExternalConstraints,
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
  getDeviceStatus,
  getSyncStatus,

  // 设备管理（B 组，多 key + 激活设备）
  createDevice,
  updateDeviceById,
  deleteDeviceById,
  setActiveDevice,
  syncDevice,
}

export default recordingApi
