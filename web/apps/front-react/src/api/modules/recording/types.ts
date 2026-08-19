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
  group_id?: number             // 录音文件分组 ID

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
  group_id?: number           // 分组 ID，用于分类
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
  group_id?: number
  insight_summary?: string
  insight_page?: {
    page_json?: string
  } 
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
  sort_by?: 'updated_time' | 'created_time'
  group_id?: number
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
  group_id?: number           // 分组 ID，用于分类
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
  voice_model_name?: string
  recording_agent_enabled?: boolean
}

// ============= 录音错误码 =============

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

// ============= 总结模板 =============

/** 录音总结模板（前台接口返回格式） */
export interface RecordingSummaryTemplate {
  id: string
  name: string
  description: string
  prompt: string
  group_id: number
  created_time: number
  updated_time: number
}

// ============= 文件总结 =============

/** 总结生成状态（异步生成模式下使用） */
export type SummaryStatus = 'processing' | 'completed' | 'failed'

/** 录音文件总结 */
export interface RecordingFileSummary {
  id: string
  file_id: string
  template_id: number
  template_name: string
  inference_model_id: number
  /**
   * 生成状态：processing=生成中、completed=已完成、failed=生成失败
   * 旧版本接口可能不返回该字段，UI 层默认视为 completed
   */
  status?: SummaryStatus
  summary_content: string
  created_time: number
  updated_time: number
}

// ============= 解析状态 =============

/** 失败错误类型（status = failed 时由后端返回） */
export type ParseStageErrorType =
  | 'insufficient_balance'
  | 'api_key_invalid'
  | 'timeout'
  | 'asr_failed'
  | 'model_unavailable'

/** 解析阶段状态 */
export interface StageStatus {
  status: string // normal/pending/parsing/processing/completed/failed/skipped/inactive
  pipeline?: 'active' | 'failed' | 'inactive' // 管线可达性
  /** @保留字段以兼容后端响应；前端已不再消费 */
  pending_reason?: string
  /** 失败错误类型（仅 status = failed 时有值） */
  error_type?: ParseStageErrorType
  updated_at: number
}

/** 文件解析状态 */
export interface FileParseStatus {
  transcription: StageStatus
  meeting_minutes: StageStatus
  insights: StageStatus
  insight_page: StageStatus
}

// ============= 决策页面编排 =============

/** 决策页面编排结果 */
export interface RecordingFileInsightPage {
  id: number
  file_id: number
  /** Markdown 字符串（新）或 JSON Block 字符串（旧），前端需兼容判断 */
  page_json: string
  created_time: number
  updated_time: number
}

/** 洞察协同研讨中的背景快照 */
export interface InsightConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface InsightBackground {
  personal_info: string
  company_info: string
  historical_context: string
  external_constraints: string
  material_context: string
  conversation?: InsightConversationMessage[]
}

export interface InsightWorkshopChatRequest {
  message: string
  background: InsightBackground
  conversation: InsightConversationMessage[]
}

export interface InsightWorkshopChatResponse {
  reply: string
}

/** 页面编排 Block 类型 */
export interface DecisionPageBlock {
  id: string
  type: 'page_header' | 'decision_banner' | 'hero_judgment' | 'section' | 'paragraph' | 'quote'
       | 'callout' | 'risk_list' | 'comparison' | 'flow_diagram' | 'assumption_chain' | 'timeline'
       | 'ordered_list' | 'unordered_list' | 'action_list' | 'rule_list'
       | 'red_line' | 'verification_list' | 'closing'
       | 'key_points' | 'long_analysis' | 'insight_stack' | 'breakthrough'
       /** 前端从 ```mermaid 围栏解析出的非流程图方言（sequence / pie / gantt / timeline） */
       | 'mermaid_diagram'
  importance: number
  source_unit_ids: string[]
  variant: 'neutral' | 'info' | 'positive' | 'warning' | 'danger' | 'critical' | 'dark'
  data: Record<string, any>
}

/** mermaid-flow.v1 图数据（由后端 parse_mermaid_flow 产出） */
export interface MermaidFlowNode {
  id: string
  title: string
  content: string
  tone: 'neutral' | 'positive' | 'info' | 'warning' | 'danger' | 'critical' | 'pending'
  rank: number
}

export interface MermaidFlowEdge {
  from: string
  to: string
  label: string
}

export interface MermaidFlowDiagram {
  direction: 'TB' | 'LR'
  nodes: MermaidFlowNode[]
  edges: MermaidFlowEdge[]
}

/** 编排后的决策页面 */
export interface DecisionPage {
  schema_version: string
  document_type: string
  title: string
  subtitle: string
  theme: 'blue' | 'purple' | 'orange' | 'red' | 'dark' | 'neutral'
  blocks: DecisionPageBlock[]
  closing: { content: string }
}

// ============= 排队文件数 =============

/** 排队文件数响应 */
export interface QueuedCountResponse {
  queued_count: number
}

// ============= 会议记忆总览 =============

export type RecordingMemoryKind =
  | 'decision'
  | 'commitment'
  | 'action'
  | 'risk'
  | 'opportunity'
  | 'viewpoint'
  | 'issue'
  | 'open_question'
  | 'quote'

export interface RecordingMemoryStats {
  total_claims: number
  source_meetings: number
  confirmed_decisions: number
  active_commitments: number
  active_risks: number
  needs_confirmation: number
  evidence_coverage: number
  uncompiled_meetings: number
}

export interface RecordingMemoryClaimItem {
  id: string | number
  file_id: string | number
  claim_kind: RecordingMemoryKind
  content: string
  assertion_state: string
  epistemic_type: string
  lifecycle_state: string
  review_state: string
  source_confidence: number
  evidence_available: boolean
  source_segment_count: number
  source_file: string
  updated_time: number
}

export interface RecordingMemoryOverview {
  stats: RecordingMemoryStats
  items: RecordingMemoryClaimItem[]
  kinds: Array<{ kind: RecordingMemoryKind; count: number }>
}

export type RecordingMemoryEntityType = 'person' | 'matter' | 'risk' | 'principle'

/**
 * 会议记忆实体的单个属性 schema 定义
 * - label：中文展示名（来自后端，前端零硬编码）
 * - values：枚举值映射；缺省即为自由文本字段，值原样展示
 */
export interface RecordingMemoryEntitySchemaAttribute {
  label: string
  values?: Record<string, string>
}

/** 某类实体的 schema：类型中文名 + 全部属性定义 */
export interface RecordingMemoryEntitySchema {
  label: string
  attributes: Record<string, RecordingMemoryEntitySchemaAttribute>
}

/** 全量实体 schema：键为 entity_type，值为该类型的定义 */
export type RecordingMemoryEntitySchemas = Record<RecordingMemoryEntityType, RecordingMemoryEntitySchema>

export interface RecordingMemoryEntityItem {
  id: string | number
  entity_type: RecordingMemoryEntityType
  canonical_name: string
  summary: string
  fact_count: number
  source_meetings: number
  last_fact_at: number
  updated_time: number
}

export interface RecordingMemoryEntityList {
  items: RecordingMemoryEntityItem[]
  total: number
}

export interface RecordingMemoryEntityFact {
  id: string | number
  entity_type: RecordingMemoryEntityType
  fact_kind: 'extracted' | 'manual_correction'
  content: string
  attributes: Record<string, string>
  source_segment_ids: string[]
  source_type: 'automatic' | 'manual'
  occurred_at: number
  source_file: string
  file_id: string | number
  updated_time: number
}

export interface RecordingMemoryEntityRelation {
  id: string | number
  related_entity_id: string | number
  related_name: string
  related_type: RecordingMemoryEntityType
  relation_type: string
}

export interface RecordingMemoryEntityDetail extends RecordingMemoryEntityItem {
  attributes: Record<string, string>
  aliases: string[]
  first_mentioned_at: number
  facts: RecordingMemoryEntityFact[]
  relations: RecordingMemoryEntityRelation[]
}

export interface UpdateRecordingMemoryEntityRequest {
  canonical_name?: string
  summary?: string
  attributes?: Record<string, string>
}

// ============= 转写原文 🆕 =============

/** 转写原文响应 */
export interface FileTranscriptionResponse {
  file_id: number
  /** 转写纯文本 */
  content: string
}

// ============= 转写导出 =============

/**
 * 转写导出响应（后端把 DashScope 转写 JSON 渲染为 Markdown 直接返回，
 * 前端拿到字符串自行展示/复制/保存）
 */
export interface TranscriptionExportResponse {
  file_id: string
  /** 建议的文件名（含 .md 后缀） */
  file_name: string
  /** 渲染好的 Markdown 正文 */
  markdown: string
}

// ============= 继续生成管线 🆕 =============

/** 继续生成管线响应 */
export interface PipelineResult {
  file_id: string
  meeting_minutes: 'skipped' | 'processing'
  insights: 'skipped' | 'processing'
  insight_page: 'skipped' | 'processing'
}

// ============= 移动文件到分组 🆕 =============

/**
 * 移动文件到分组请求
 * group_id = 0 表示移出分组（未分组）
 */
export interface MoveFileToGroupRequest {
  group_id: number
}

/** 移动文件到分组响应 */
export interface MoveFileToGroupResponse {
  file_id: string
  group_id: number
}

// ============= 录音分享 🆕 =============

/** 创建录音分享响应（share_id 为 10 位随机串，链接永久有效、无取消接口） */
export interface RecordingShareCreateResponse {
  share_id: string
}

/**
 * 分享内容快照（匿名可访问）
 *
 * 后端按文件实际内容存在性返回字段，不是全量结构 —— 除 title 外都可能缺省，
 * 前端必须按"字段有没有"来决定展示哪些 Tab，不能假设一定存在。
 *
 * transcription 后端已预渲染为 `[hh:mm:ss] 说话人: 文本` 风格的 Markdown，
 * 不再返回原始语音模型 JSON；音频地址也不再直接下发，前端从 upload_file.preview_key
 * 还原 /api/preview/{key} 给 AudioPlayerBar 用。
 */
export interface RecordingSharedContent {
  /** 文件 HashID，匿名访问也返回 */
  file_id: string
  /** 文件名 */
  title: string
  /** 转写 Markdown（`# 文件名\n[hh:mm:ss] 说话人: 内容`） */
  transcription?: string
  /** 总结/纪要列表，含 template_id = 0 的纪要，后端不做过滤 */
  summaries?: RecordingFileSummary[]
  /** 洞察页面编排结果（Markdown 字符串，含 mermaid 代码块等） */
  insight_page?: string
  /** 音频时长（毫秒） */
  duration_ms?: number
  /** 文件创建时间戳 */
  created_time?: number
  /** 分享创建人头像 URL（可能为空） */
  avatar?: string
  /** 分享创建人昵称 */
  nickname?: string
  /** 后端透传的原始上传文件元信息（preview_key 用于还原音频播放地址） */
  upload_file?: RecordingSharedUploadFile
}

/** 分享快照中的上传文件元信息（preview_key → /api/preview/{key} 是分享页唯一的音频来源） */
export interface RecordingSharedUploadFile {
  id: string
  eid: string
  file_name: string
  extension: string
  size: number
  mime_type: string
  hash: string
  key: string
  preview_key: string
  status: string
  source_type: string
  user_id: number
  message_id: number
  error: string
  cleanup_retry_count: number
  created_time: number
  updated_time: number
  processed_time: number
}

// ============= SonicNote 设备与同步 🆕 =============

/**
 * 录音设备品牌类型
 * - 'sonicnote'：当前已对接
 * - 'soninote' / 'ticnote'：UI 占位，待后续接入
 */
export type RecordingDeviceType = 'sonicnote' | 'soninote' | 'ticnote'

/** 设备配置项（单条） */
export interface RecordingDeviceConfig {
  device_type: RecordingDeviceType
  /** API Key 明文（用户自己的 Key，前端不做脱敏） */
  api_key: string
  enabled: boolean
}

/**
 * 设备配置 PUT 请求
 *
 * - api_key 传空字符串表示"不修改、保留原值"，传具体值则覆盖
 * - enabled 可单独切换；不传则后端视为不修改
 */
export interface RecordingDeviceConfigUpdate {
  device_type: RecordingDeviceType
  api_key?: string
  enabled?: boolean
}

/**
 * 设备可用性探测响应
 * 实时探测设备是否可用（Login 成功 + 列表接口可达），非缓存。
 *
 * 注意：HTTP 200 + code 0 即便 available=false 也是成功响应，
 * 真正的网络/服务异常会进入 reason 字段（如 'network_error'）。
 * 仅当 HTTP 层面失败时 axios 才会 reject。
 */
export interface RecordingDeviceStatusResponse {
  device_type: RecordingDeviceType
  /** 是否已配置 Key */
  configured: boolean
  /** 设备是否启用 */
  enabled: boolean
  /** 是否可用（Login 成功 + 列表接口可达） */
  available: boolean
  /** 远端录音总数（可用时为真实值，否则 0） */
  total_recordings: number
  /** 不可用原因：未配置设备 / 设备未启用 / key_invalid / network_error / 探测失败: <详情> */
  reason?: string
}

/** 触发 SonicNote 同步请求 */
export interface SyncSonicNoteRequest {
  /** true 忽略去重标记全量重新导入（会重建文件，谨慎使用） */
  force?: boolean
  /** 本次同步最多处理的远端录音条数；0=不限（默认）；负数由后端报 400 */
  limit?: number
}

/** 触发 SonicNote 同步响应 */
export interface SyncSonicNoteResponse {
  job_id: string
}

/**
 * 同步任务状态（对齐 mine-audio.md 4.3 同步状态轮询）
 *
 * - running：进行中，继续轮询
 * - completed / failed：正常终态，结束轮询
 * - interrupted：服务重启导致后台任务被中断的终态，前端提示用户重试
 *
 * 后端没有 'pending' 概念：running 涵盖启动期。
 */
export type SyncStatus = 'running' | 'completed' | 'failed' | 'interrupted'

/** 同步任务状态响应 */
export interface SyncStatusResponse {
  job_id: string
  status: SyncStatus
  /** 同步开始时间戳（毫秒） */
  started_at?: number
  /** 同步结束时间戳（毫秒），进行中时为 null */
  finished_at?: number | null
  /** 远端发现的录音条数（含已同步跳过的条目） */
  discovered: number
  /** 本次实际导入的条数 */
  imported: number
  /** 跳过（已存在）的条数 */
  skipped: number
  /** 失败的条数 */
  failed: number
  /** 失败时的错误信息 */
  error_message?: string
}
