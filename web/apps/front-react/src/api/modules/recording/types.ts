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
  insight_regenerate_enabled?: boolean
}

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
  error?: string
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
export type CanonicalInsightPerspective =
  | 'management_meeting'
  | 'customer_communication'
  | 'project_review'
  | 'business_cooperation'
  | 'business_innovation'
  | 'employee_conversation'
  | 'industry_exchange'
  | 'management_course'

/** 包含存量数据的历史场景值；新选择器只使用 CanonicalInsightPerspective。 */
export type InsightPerspective =
  | CanonicalInsightPerspective
  | 'auto'
  | 'external_training'
  | 'external_speech'
  | 'roadshow'
  | 'sales_visit'
  | 'internal_meeting'
  | 'lecture'
  | 'book'
  | 'one_on_one'
  | 'hiring'
  | 'general'

export const DEFAULT_INSIGHT_PERSPECTIVE: CanonicalInsightPerspective = 'management_meeting'

export function toCanonicalInsightPerspective(value?: InsightPerspective | string): CanonicalInsightPerspective {
  switch (value) {
    case 'external_training':
    case 'lecture':
      return 'management_course'
    case 'sales_visit':
      return 'customer_communication'
    case 'internal_meeting':
    case 'general':
    case 'auto':
    case 'external_speech':
    case 'roadshow':
    case 'book':
    case 'hiring':
    case 'one_on_one':
    case undefined:
      return DEFAULT_INSIGHT_PERSPECTIVE
    case 'management_meeting':
    case 'customer_communication':
    case 'project_review':
    case 'business_cooperation':
    case 'business_innovation':
    case 'employee_conversation':
    case 'industry_exchange':
    case 'management_course':
      return value
    default:
      return DEFAULT_INSIGHT_PERSPECTIVE
  }
}

export function resolveInsightPerspectiveForSubmit(
  original: InsightPerspective | undefined,
  selected: CanonicalInsightPerspective,
  changed: boolean,
): InsightPerspective {
  return changed ? selected : original || 'auto'
}

const LEGACY_INSIGHT_PERSPECTIVE_NAMES: Record<string, string> = {
  auto: '自动判断',
  external_training: '参与外部培训会议',
  external_speech: '去别人公司演讲',
  roadshow: '路演会议',
  sales_visit: '销售拜访',
  internal_meeting: '公司内部会议',
  lecture: '听一堂课',
  book: '读一本书',
  one_on_one: '一对一',
  hiring: '招聘',
  general: '通用',
}

export function getInsightPerspectiveDisplayName(
  value: InsightPerspective | string | undefined,
  options: InsightPerspectiveOption[],
): string {
  if (!value) return '尚未记录'
  const option = options.find((item) => item.key === value)
  if (option) return option.name
  return `历史场景：${LEGACY_INSIGHT_PERSPECTIVE_NAMES[value] || value}`
}

export interface InsightPerspectiveOption {
  key: CanonicalInsightPerspective
  name: string
  description: string
}

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
  insight_perspective?: InsightPerspective
  resolved_insight_perspective?: InsightPerspective
  perspective_confidence?: number
  perspective_reason_codes?: string[]
  perspective_evidence?: string[]
  perspective_abstained?: boolean
}

export interface InsightWorkshopChatRequest {
  message: string
  background: InsightBackground
  conversation: InsightConversationMessage[]
}

export interface InsightWorkshopChatResponse {
  reply: string
}

export interface InsightRegenerationRequest {
  background: InsightBackground
  conversation: InsightConversationMessage[]
  insight_perspective: InsightPerspective
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

// ============= 排队文件数 =============

/** 排队文件数响应 */
export interface QueuedCountResponse {
  queued_count: number
}

// ============= 会议记忆实体 =============

export type RecordingMemoryEntityType = 'person' | 'matter' | 'risk' | 'principle'

/**
 * 会议记忆实体的单个属性 schema 定义
 * - label：中文展示名（来自后端，前端零硬编码）
 * - values：枚举候选（value 存库，label 展示）；缺省即为自由文本字段，值原样展示
 */
export interface RecordingMemoryEntitySchemaAttribute {
  key: string
  label: string
  values?: Array<{ label: string; value: string }>
}

/** 某类实体的 schema：类型 key + 中文名 + 全部属性定义 */
export interface RecordingMemoryEntitySchema {
  type: RecordingMemoryEntityType
  label: string
  attributes: RecordingMemoryEntitySchemaAttribute[]
}

/** 全量实体 schema：后端返回数组，键值对类型改为在条目的 type 字段上暴露 */
export type RecordingMemoryEntitySchemas = RecordingMemoryEntitySchema[]

export interface RecordingMemoryEntityItem {
  id: string | number
  entity_type: RecordingMemoryEntityType
  canonical_name: string
  summary: string
  fact_count: number
  source_meetings: number
  /** 最近一条事实的来源文件;用于暂存关联卡片的文件名展示 */
  source_file?: string
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
  /** 关联实体的 id（0 表示无关联） */
  related_entity_id: string | number
  /** 关联实体的名称 */
  related_name: string
  /** 关联实体的类型 */
  related_type: string
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

// ============= Current View / Timeline =============

export type RecordingCurrentViewState = 'resolved' | 'unknown' | 'conflicted' | 'degraded' | 'unsupported'

export interface RecordingCurrentViewEvidence {
  file_id?: string | number
  source_file?: string
  source_segments?: string[]
  source_type?: string
  confidence?: number
}

export interface RecordingCurrentViewItem {
  id: string | number
  kind: string
  content: string
  status?: string
  source_type?: string
  confidence?: number
  evidence_refs?: RecordingCurrentViewEvidence[]
  source_file?: string
  source_segments?: string[]
  timestamp?: number
  current_validity?: string
  lifecycle?: string
}

export interface RecordingCurrentViewValue {
  state: RecordingCurrentViewState
  support: string
  value?: string
  candidate_refs?: Array<string | number>
  evidence_refs?: RecordingCurrentViewEvidence[]
}

export interface RecordingCurrentViewList {
  state: RecordingCurrentViewState
  support: string
  items?: RecordingCurrentViewItem[]
  uncertain_items?: RecordingCurrentViewItem[]
  candidate_refs?: Array<string | number>
  evidence_refs?: RecordingCurrentViewEvidence[]
}

export interface RecordingCurrentViewRisk extends RecordingCurrentViewList {}

export interface RecordingCurrentViewFacets {
  current_status: RecordingCurrentViewValue
  current_position: RecordingCurrentViewValue
  current_demands: RecordingCurrentViewList
  current_risks: RecordingCurrentViewRisk
  current_opportunities: RecordingCurrentViewList
  open_loops: RecordingCurrentViewList
  recent_updates: RecordingCurrentViewList
  recent_changes: RecordingCurrentViewList
  evidence_refs: RecordingCurrentViewEvidence[]
}

export interface RecordingCurrentViewEntity {
  id: string | number
  entity_type: string
  canonical_name: string
  matter_kind?: RecordingCurrentViewValue
}

export interface RecordingCurrentViewConflict {
  facet: string
  reason: string
  candidates: RecordingCurrentViewItem[]
}

export interface RecordingCurrentViewResponse {
  entity: RecordingCurrentViewEntity
  current_view: RecordingCurrentViewFacets
  conflicts?: RecordingCurrentViewConflict[]
  compiled_at: string
}

export interface RecordingMemoryTimelineItem {
  id: string | number
  timestamp: number
  entity: RecordingCurrentViewEntity
  record_type: 'fact' | 'claim' | string
  fact_kind?: string
  claim_kind?: string
  event_type: string
  content: string
  previous_value?: string
  new_value?: string
  source_file?: string
  source_segments?: string[]
  source_type?: string
  epistemic_type?: string
  confidence?: number
  current_validity: 'active' | 'invalid' | 'compiler_replaced' | 'unknown' | string
  lifecycle?: string
  status?: string
  due_at?: number
  evidence_refs?: RecordingCurrentViewEvidence[]
}

export interface RecordingMemoryTimeline {
  entity: RecordingCurrentViewEntity
  items: RecordingMemoryTimelineItem[]
  total: number
  offset: number
  limit: number
  has_more: boolean
  compiled_at: string
}

export interface UpdateRecordingMemoryEntityRequest {
  canonical_name?: string
  summary?: string
  attributes?: Record<string, string>
  facts?: Array<{ id?: string | number; related_entity_id: string }>
  deleted_fact_ids?: Array<string | number>
}


export interface CreateRecordingMemoryEntityRequest {
  entity_type: RecordingMemoryEntityType
  canonical_name: string
  summary?: string
  attributes?: Record<string, string>
  facts?: Array<{ related_entity_id: string }>
}

/**
 * 融合请求体：`source_ids`（多源）为主，旧 `source_id`（单源）保留兼容。
 * `target_id` 不能出现在 `source_ids` 中。
 * 文档 §6。
 */
export interface MergeMemoryEntitiesRequest {
  source_ids?: Array<string | number>
  source_id?: string | number
  target_id: string | number
}

// ============= 老板认知注册与会议校准 =============

export type RecordingCognitionCanonicalType =
  | 'principle'
  | 'priority'
  | 'criterion'
  | 'preference'
  | 'boundary'
  | 'assumption'
  | 'trigger'

/** @deprecated Only retained for legacy payload compatibility. */
export type RecordingCognitionLegacyType =
  | 'principle'
  | 'preference'
  | 'risk_preference'
  | 'decision_style'
  | 'red_line'
  | 'assumption'

/** @deprecated Use RecordingCognitionCanonicalType for all new semantics. */
export type RecordingCognitionType = RecordingCognitionLegacyType

export type RecordingCognitionLayer = 'core' | 'situational'
export type RecordingCognitionStatus = 'candidate' | 'confirmed' | 'conflicted' | 'expired' | 'rejected'

export interface RecordingCognitionEvidenceRef {
  source_file_id: string | number
  /** Current recording filename resolved from source_file_id; absent when the source was removed or unavailable. */
  source_file_name?: string
  source_file_time?: number
  source_segment_ids: string[]
  source_type?: string
}

export interface RecordingCognition {
  /** 认知 HashID */
  id: string | number
  title: string
  statement: string
  /** 7 大认知分类（principle / priority / criterion / preference / boundary / assumption / trigger） */
  cognition_type: RecordingCognitionCanonicalType | string
  layer: RecordingCognitionLayer | string
  /** 所属领域 HashID（core 认知通常为空） */
  domain_id?: string
  /** 领域中文名称 */
  domain_name?: string
  status: RecordingCognitionStatus | string
  source_type: string
  confidence: number
  /** 关联的录音文件 */
  source_file_id?: string | number
  source_file_name?: string
  source_file_time?: number
  current_version: number
  evidence_refs?: RecordingCognitionEvidenceRef[]
  created_time?: number
  updated_time?: number
}

export interface RecordingCognitionVersion {
  id: string | number
  cognition_id: string | number
  version: number
  title: string
  statement?: string
  cognition_type?: string
  layer?: RecordingCognitionLayer | string
  domain_id?: string
  domain_name?: string
  change_type: string
  source_file_id?: string | number
  source_file_name?: string
  source_file_time?: number
  source_segment_ids?: string[]
  evidence_refs?: RecordingCognitionEvidenceRef[]
  created_at_unix: number
}

export interface RecordingCognitionDetail extends RecordingCognition {
  versions: RecordingCognitionVersion[]
}

export interface RecordingCognitionList {
  items: RecordingCognition[]
  total: number
}

export interface RecordingCognitionCandidate {
  id: string | number
  eid: string | number
  owner_id: string | number
  file_id: string | number
  title: string
  statement: string
  cognition_type: string
  legacy_type?: string
  canonical_type?: RecordingCognitionCanonicalType | string
  canonical_type_status?: 'candidate' | 'confirmed' | 'not_classified' | string
  type_schema_version?: string
  layer: RecordingCognitionLayer | string
  domain_code?: string
  scope: string[]
  source_type: string
  confidence: number
  source_file_id: string | number
  source_file_name?: string
  source_segment_ids: string[]
  status: 'candidate' | 'confirmed' | 'rejected' | 'ignored' | string
  review_reason?: string
  target_cognition_id?: string | number
  reviewed_by?: string | number
  reviewed_at?: number
  evidence_refs?: RecordingCognitionEvidenceRef[]
  external_source?: string
  external_ref?: string
  observed_at?: number
  created_time?: number
  updated_time?: number
}

export interface RecordingCognitionCandidateList {
  items: RecordingCognitionCandidate[]
  total: number
}

export interface RecordingCognitionOverview {
  core_count: number
  situational_count: number
  pending_count: number
  core_type_count: number
  domain_count: number
}

export interface RecordingCoreStats {
  principle: number
  priority: number
  criterion: number
  preference: number
  boundary: number
  assumption: number
  trigger: number
  total: number
}

export interface RecordingCognitionDomain {
  id: string
  code: string
  name: string
  description: string
  logo: string
  sort: number
  /** true=系统预置，false=个人自建 */
  is_default: boolean
  /** 是否被当前登录人重写（写时复制）
   */
  is_overridden: boolean
  /** 该领域下已生效的认知条数 */
  cognition_count: number
  /** 该领域下待确认的认知条数 */
  pending_count: number
  /** 最后更新时间戳(毫秒) */
  last_updated_time?: number
}

export interface CreateRecordingCognitionDomainRequest {
  name: string
  description?: string
  logo?: string
  sort?: number
}

export interface UpdateRecordingCognitionDomainRequest {
  name?: string
  description?: string
  logo?: string
  sort?: number
}

export interface CreateRecordingCognitionRequest {
  title: string
  statement: string
  cognition_type: RecordingCognitionCanonicalType
  layer: RecordingCognitionLayer
  /** 所属领域 HashID（situational 必传） */
  domain_id?: string
  source_type: string
  confidence: number
}

export interface ImportRecordingCognitionItemRequest {
  title: string
  statement: string
  cognition_type?: RecordingCognitionLegacyType
  canonical_type: RecordingCognitionCanonicalType
  canonical_type_status?: 'candidate' | 'confirmed' | 'not_classified'
  domain_code?: string
  layer: RecordingCognitionLayer
  scope?: string[]
  confidence?: number
  external_source: string
  external_ref: string
  observed_at?: number
  evidence_refs?: RecordingCognitionEvidenceRef[]
}

export interface ImportRecordingCognitionsRequest {
  items: ImportRecordingCognitionItemRequest[]
}

export interface UpdateRecordingCognitionRequest {
  title?: string
  statement?: string
  cognition_type?: RecordingCognitionCanonicalType
  /** 状态流转，供正式候选确认/拒绝流程使用 */
  status?: RecordingCognitionStatus
}

export interface ReviewRecordingCognitionCandidateRequest {
  title?: string
  statement?: string
  scope?: string[]
  cognition_type?: RecordingCognitionLegacyType
  canonical_type?: RecordingCognitionCanonicalType
  canonical_type_status?: 'candidate' | 'confirmed' | 'not_classified'
  domain_code?: string
  layer?: RecordingCognitionLayer
  reason?: string
}

/**
 * 编辑待确认候选请求（PATCH /api/recordings/cognition-candidates/:candidate_id）。
 * 在确认前修正 AI 提炼的内容；仅 status=candidate 的候选可编辑，
 * confirmed/rejected/ignored 返回 400。未传字段保持原值。
 */
export interface UpdateRecordingCognitionCandidateRequest {
  title?: string
  statement?: string
  cognition_type?: RecordingCognitionCanonicalType
  layer?: RecordingCognitionLayer
  domain_id?: string
  scope?: string[]
}

export interface RecordingDecisionCurrentContext {
  file_id: string | number
  generation: number
  minutes_hash: string
  primary_scene?: string
  secondary_domains?: string[]
  topics?: string[]
  segment_ids: string[]
  claims: Array<{ temp_id: string; kind: string; content: string; evidence_segment_ids: string[] }>
  entities: Array<{ temp_id: string; entity_type: string; mention: string; canonical_name: string; evidence_segment_ids: string[] }>
  relations: Array<{ from_temp_id: string; relation_type: string; to_temp_id: string; evidence_segment_ids: string[] }>
  claim_entity_bindings: Array<{ claim_temp_id: string; entity_temp_id: string; role: string; evidence_segment_ids: string[] }>
}

export interface RecordingDecisionMemoryItem {
  memory_id: string | number
  kind: string
  content: string
  assertion_state: string
  lifecycle_state: string
  review_state: string
  source_file_id: string | number
  source_file: string
  source_confidence: number
  evidence_available: boolean
  source_segment_ids: string[]
  recall_path: string[]
  structured_links?: string
}

export interface RecordingDecisionContextPackage {
  current_context: RecordingDecisionCurrentContext
  cognitions: {
    core: Array<Pick<RecordingCognition, 'id' | 'title' | 'statement' | 'cognition_type' | 'layer' | 'domain_id' | 'domain_name' | 'confidence' | 'source_type' | 'evidence_refs' | 'current_version' | 'created_time' | 'updated_time'>>
    situational: Array<Pick<RecordingCognition, 'id' | 'title' | 'statement' | 'cognition_type' | 'layer' | 'domain_id' | 'domain_name' | 'confidence' | 'source_type' | 'evidence_refs' | 'current_version' | 'created_time' | 'updated_time'>>
    conflicts: Array<Pick<RecordingCognition, 'id' | 'title' | 'statement' | 'cognition_type' | 'layer' | 'domain_id' | 'domain_name' | 'confidence' | 'source_type' | 'evidence_refs' | 'current_version' | 'created_time' | 'updated_time'>>
  }
  business_memory: { items: RecordingDecisionMemoryItem[] }
  evidence_policy: {
    current_facts_first: boolean
    require_source_segments: boolean
    max_relation_hops: number
    memory_v2_shadow_only: boolean
  }
  omitted_reasons: string[]
  retrieval_reasons?: string[]
  query_plan?: {
    version: string
    question?: string
    claim_anchors?: string[]
    entity_anchors?: string[]
    primary_scene?: string
    secondary_domains?: string[]
    topics?: string[]
    priority: string[]
    reasons?: string[]
    degraded: boolean
    degrade_reason?: string
  }
  runtime_context?: RecordingDecisionRuntimeContext
  built_at_unix: number
}

export interface RecordingDecisionRuntimeItem {
  audit_item_id: string
  source_id: string
  content: string
  evidence_refs?: string[]
}

export interface RecordingDecisionRuntimeContext {
  context_version: string
  current_context: RecordingDecisionRuntimeItem[]
  boss_cognition: RecordingDecisionRuntimeItem[]
  business_memory: RecordingDecisionRuntimeItem[]
  enterprise_knowledge: RecordingDecisionRuntimeItem[]
  evidence_refs: string[]
  degraded: boolean
  degradation_reasons?: string[]
}

export interface RecordingMemoryV2Evaluation {
  insight_generation: number
  projection_version: string
  baseline_count: number
  v2_count: number
  overlap_count: number
  baseline_only_count: number
  v2_only_count: number
  baseline_evidence_count: number
  v2_evidence_count: number
  duration_ms: number
  status: string
  created_at_unix: number
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
 * - 'sonicnote'：SonicNote（妙记），MCP Key `sk-` 开头
 * - 'ticnote'：TicNote，AppKey `tncn_sk_` / `tnovs_sk_` 开头
 * - 'soninote'：UI 占位，待后续接入
 */
export type RecordingDeviceType = 'sonicnote' | 'soninote' | 'ticnote'

/**
 * 设备配置项（单条）
 *
 * 后端 GET /devices 返回结构（多 key 场景）：
 * - id：HashID，前端按 id 精确操作单条（更新/删除/设激活/指定同步）
 * - is_active：当前激活设备标记（首条自动激活，新增不自动切换）
 * - api_key：脱敏后（前 4 + **** + 后 4），前端不展示明文
 */
export interface RecordingDeviceConfig {
  /** 设备配置 HashID（增量：B 组接口返回，旧接口可能没有） */
  id?: string
  device_type: RecordingDeviceType
  /** API Key（用户自己查看自己的 Key 时是明文；管理/分享场景下后端会脱敏） */
  api_key: string
  enabled: boolean
  /** 当前激活设备标记（增量：仅 B 组接口返回） */
  is_active?: boolean
}

/**
 * 添加设备配置请求（B 组 POST /api/recordings/devices）
 * - api_key 必填；同企业同类型同 key 已被他人绑定 → 400
 * - enabled 缺省 true
 */
export interface CreateDeviceRequest {
  device_type: RecordingDeviceType
  api_key: string
  enabled?: boolean
}

/**
 * 按 id 更新设备配置请求（B 组 PUT /api/recordings/devices/{id}）
 * - api_key 为空保留原值
 * - enabled 缺省保留原值
 * - device_type 可改
 */
export interface UpdateDeviceByIdRequest {
  device_type?: RecordingDeviceType
  api_key?: string
  enabled?: boolean
}

/**
 * 统一同步入口请求（B 组 POST /api/recordings/sync）
 * - device_type 必填
 * - device_id 可选：指定单条配置同步；缺省同步该 type 全部启用配置
 * - force 已弃用（保留兼容）
 * - limit 调试用
 */
export interface SyncDeviceRequest {
  device_type: RecordingDeviceType
  device_id?: string
  force?: boolean
  limit?: number
}

/** 统一同步入口响应 */
export interface SyncDeviceResponse {
  job_id: string
}

/** 添加设备配置响应（返回新配置 id） */
export interface CreateDeviceResponse {
  id: string
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
  /** 当前同步任务对应的设备类型（sonicnote / ticnote）；后端透传字段 */
  provider?: RecordingDeviceType
}
