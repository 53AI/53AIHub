/**
 * 录音 · 行动系统（Action System）API
 *
 * 对接文档：KM-Record《20260920-安心录-行动系统-前端对接.md》。
 * 链路：洞察 → 检测行动机会（detect）→ 生成/编辑/确认行动计划（plan）
 *      → 订阅执行（run, SSE）→ 验收/返工 → 行动成果（result）。
 *
 * 所有对外 ID（file_id / opportunity_id / plan_id / run_id / artifact_id /
 * result_asset_id）均为后端 Hashids 编码字符串，前端原样透传。
 *
 * 错误处理：全部走 handleError({ignoreMessage}) —— 保留 401 登出等全局处理，
 * 但不弹 toast，由调用方（弹窗组件）自行决定展示方式（内联错误 / message.error）。
 */

import request from '../../index'
import { get, post, patch } from '../../config'
import { handleError } from '../../errorHandler'

// ============= 子结构 =============

/** 原始会议来源入口（可导航录音链接） */
export interface ActionSourceLink {
  source_type: string
  /** 可导航录音 ID（仅 available 时下发） */
  recording_id?: string
  title?: string
  occurred_at?: number
  /** available=可点击进会议详情；deleted=原始录音已删除；unavailable=来源暂不可用 */
  availability: string
}

/** 来源引用（角色 + 类型 + canonical_id + 版本） */
export interface ActionSourceRef {
  role: string
  source_type: string
  canonical_id: string
  source_version?: string
}

/** 交付物。计划须且仅须一个 is_primary=true；format 为物理格式唯一权威 */
export interface ActionDeliverable {
  type: string
  title: string
  format?: 'docx' | 'xlsx' | 'pptx'
  is_primary?: boolean
}

/** 执行步骤 */
export interface ActionExecutionStep {
  order: number
  title: string
  description: string
}

/** 所需输入 */
export interface ActionRequiredInput {
  name: string
  source: string
  required: boolean
}

/** 权限需求 */
export interface ActionPermission {
  capability: string
  resource: string
  scope: string
  approval: string
}

/** 验收标准 */
export interface ActionAcceptanceCriterion {
  order: number
  description: string
}

/** 风险与缓解 */
export interface ActionRisk {
  order: number
  description: string
  mitigation: string
}

/** 行动证据引用 */
export interface ActionEvidenceRef {
  source_type: string
  source_id: string
  segment_id?: string
  excerpt?: string
  timestamp?: number
  position?: string
}

/** 行动意图（机会 → 计划传递的用户契约） */
export interface ActionIntent {
  objective: string
  action_type: string
  scope: string
  expected_deliverables: ActionDeliverable[]
  source_evidence: ActionEvidenceRef[]
}

// ============= 状态枚举 =============

/** 机会状态：candidate 可创建计划；planning/awaiting_confirmation/linked 已有计划；dismissed 已忽略 */
export type ActionOpportunityStatus =
  | 'candidate'
  | 'planning'
  | 'awaiting_confirmation'
  | 'linked'
  | 'dismissed'

/** 计划状态：draft 可编辑；confirmed 已锁定；superseded 已被新版本取代 */
export type ActionPlanStatus = 'draft' | 'confirmed' | 'superseded'

/** 行动业务状态（action.status，业务状态唯一权威） */
export type ActionBusinessStatus =
  | 'draft'
  | 'ready_to_confirm'
  | 'executing'
  | 'awaiting_review'
  | 'needs_attention'
  | 'accepted'

/** 执行状态（run.status） */
export type ActionRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

// ============= 数据对象 =============

/** 行动机会（ActionOpportunityView） */
export interface ActionOpportunity {
  opportunity_id: string
  /** 来源类型：insight=洞察 / meeting=会议 / conversation=会话 / result=成果 / manual=手动 */
  source_type: string
  source_id: string
  source_insight_id: string
  source_meeting_id: string
  /** 洞察版本号（洞察重生成后递增，用于失效判断） */
  insight_generation: number
  title: string
  /** 机会类型：deep_research / analysis / sop / document_generation */
  type: string
  /** 类型中文标签（专项研究/分析测算/制度与 SOP/行动方案） */
  type_label: string
  /** 识别理由（为什么值得做） */
  reason: string
  objective: string
  deliverables: ActionDeliverable[]
  /** 交付物一句话摘要 */
  display_deliverable: string
  required_capabilities: string[]
  /** 人工依赖说明 */
  human_dependency: string
  /** AI 可执行度评分 0~1 */
  ai_executable_score: number
  /** 风险等级：low / medium / high / critical */
  risk_level: string
  /** 优先级，从 1 开始，越小越优先 */
  priority: number
  status: ActionOpportunityStatus
  /** 新版回收站使用独立标记；旧后端只返回 status=dismissed。 */
  is_trashed?: boolean
  /** 统一事项接口补充的业务阶段；旧接口可缺失。 */
  item_stage?: 'proposal' | 'action' | 'result'
  source_links?: ActionSourceLink[]
  source_refs: ActionSourceRef[]
  created_time: number
  updated_time: number
}

/** 计划列表上的 Run 摘要（只用于导航，不表达业务状态） */
export interface ActionPlanLatestRunSummary {
  run_id: string
  status: ActionRunStatus
  started_at?: number
  completed_at?: number
  last_activity_at?: number
}

/** 计划列表上的执行摘要投影：status 是业务状态唯一权威 */
export interface ActionPlanActionSummary {
  action_id: string
  status: ActionBusinessStatus
  latest_run?: ActionPlanLatestRunSummary
  result_asset_id?: string
}

/** 行动计划（ActionPlanView） */
export interface ActionPlan {
  plan_id: string
  opportunity_id: string
  /** 关联行动 ID（确认后才有） */
  action_id?: string
  status: ActionPlanStatus
  /** 新版回收站独立状态，旧后端未提供。 */
  is_trashed?: boolean
  objective: string
  background: string
  scope: string
  deliverables: ActionDeliverable[]
  execution_steps: ActionExecutionStep[]
  required_inputs: ActionRequiredInput[]
  required_capabilities: string[]
  permissions: ActionPermission[]
  acceptance_criteria: ActionAcceptanceCriterion[]
  risks: ActionRisk[]
  estimated_effort: string
  revision: number
  confirmed_at?: number
  source_insight_id: string
  source_meeting_id: string
  source_links?: ActionSourceLink[]
  source_refs: ActionSourceRef[]
  result_asset?: ActionResultAsset
  action_intent: ActionIntent
  created_time: number
  updated_time: number
  action_summary?: ActionPlanActionSummary
}

/** 行动对象（ActionView） */
export interface ActionAction {
  action_id: string
  file_id: string
  action_type: string
  status: ActionBusinessStatus
  title: string
  prompt: string
  expected_artifacts: string[]
  runtime: string
  last_run_id?: string
  confirmed_at?: number
  error_code?: string
  error_message?: string
  created_time: number
  updated_time: number
}

/** 执行对象（ActionRunView） */
export interface ActionRun {
  run_id: string
  action_id: string
  plan_id?: string
  status: ActionRunStatus
  runtime: string
  runtime_thread_id?: string
  /** 最新事件序列号（SSE/replay 游标） */
  last_seq: number
  error_code?: string
  error_message?: string
  started_at?: number
  last_activity_at?: number
  finished_at?: number
  created_time: number
  updated_time: number
}

/** 产物对象（ActionArtifactView） */
export interface ActionArtifact {
  artifact_id: string
  name: string
  mime_type: string
  size: number
  download_url: string
  preview_url?: string
  /** available / unavailable / failed */
  preview_status?: string
  preview_error_code?: string
}

/** 执行事件（ActionEventView） */
export interface ActionEvent {
  seq: number
  event_id?: string
  type: string
  runtime: string
  external_id?: string
  external_method?: string
  error_code?: string
  error_message?: string
  /** 增量输出文本（流式内容） */
  delta?: string
  payload?: Record<string, any>
  artifact?: ActionArtifact
  preview?: ActionArtifact
  created_at: number
}

/** 成果产物（带 run_id 的产物视图） */
export interface ActionResultAssetArtifact {
  artifact_id: string
  run_id: string
  name: string
  mime_type: string
  size: number
  download_url: string
  preview_url?: string
  preview_status?: string
  preview_error_code?: string
}

/** 行动成果（ActionResultAssetView） */
export interface ActionResultAsset {
  result_asset_id: string
  plan_id: string
  action_id: string
  run_id: string
  opportunity_id: string
  source_insight_id: string
  source_meeting_id: string
  source_refs: ActionSourceRef[]
  title: string
  result_type: string
  summary: string
  /** active / archived */
  status: string
  artifacts: ActionResultAssetArtifact[]
  result_spec?: Record<string, any>
  source_links?: ActionSourceLink[]
  created_time: number
  updated_time: number
}

/** 确认计划响应（ActionPlanConfirmationView） */
export interface ActionPlanConfirmation {
  plan: ActionPlan
  action: ActionAction
  run: ActionRun
}

/** 重试/返工响应（ActionRunStartView） */
export interface ActionRunStart {
  action: ActionAction
  run: ActionRun
}

/** 回放响应（ActionRunReplayView） */
export interface ActionRunReplay {
  run: ActionRun
  events: ActionEvent[]
}

/** 编辑计划请求（PATCH，必填字段见后端 binding；编辑已确认计划产生新草稿） */
export interface UpdateActionPlanRequest {
  objective: string
  background: string
  scope: string
  deliverables: ActionDeliverable[]
  execution_steps: ActionExecutionStep[]
  required_inputs?: ActionRequiredInput[]
  acceptance_criteria: ActionAcceptanceCriterion[]
  risks?: ActionRisk[]
  estimated_effort?: string
}

/** 同一业务事项，阶段在 proposal → action → result 中转换，ID 始终不变。 */
export interface ActionItem {
  item_id: string
  opportunity_id: string
  title: string
  type: string
  type_label: string
  stage: 'proposal' | 'action' | 'result'
  progress_status: string
  is_read: boolean
  is_trashed: boolean
  source_type: string
  source_id: string
  source_insight_id: string
  source_meeting_id: string
  source_refs?: ActionSourceRef[]
  plan_id?: string
  action_id?: string
  run_id?: string
  result_asset_id?: string
  opportunity?: ActionOpportunity
  plan?: ActionPlan
  result?: ActionResultAsset
  created_time: number
  updated_time: number
}

export interface ActionItemPage {
  items: ActionItem[]
  total: number
  page: number
  page_size: number
  counts: { proposal: number; action: number; result: number; trash: number }
}

export interface ActionItemFilters {
  stage?: 'all' | 'proposal' | 'action' | 'result'
  status?: string
  read?: 'read' | 'unread'
  type?: string
  meeting_id?: string
  recording_file_id?: string
  insight_id?: string
  source_type?: string
  source_id?: string
  trashed?: boolean
  page?: number
  page_size?: number
}

// ============= API =============

/** 静默错误处理：保留 401 登出等全局逻辑，不弹 toast（展示交给调用方） */
function silent(error: any): Promise<never> {
  return handleError(error, { ignoreMessage: true })
}

/** 统一事项的服务器级筛选与分页；来源查询直接复用同一个接口。 */
export async function listActionItems(filters: ActionItemFilters = {}): Promise<ActionItemPage> {
  return get<ActionItemPage>('/api/actions/items', { params: filters }).catch(silent)
}

export async function getActionItem(itemId: string): Promise<ActionItem> {
  return get<ActionItem>(`/api/actions/items/${itemId}`).catch(silent)
}

/**
 * 检测行动机会
 * POST /api/recordings/files/{file_id}/action-opportunities/detect
 *
 * 对指定录音文件的会议洞察执行机会识别（LLM 生成，最多 3 个候选）。
 * 同一洞察已有机会时直接返回已有结果（幂等）。
 * 409 = 会议洞察尚未生成；503 = 机会识别服务暂不可用。
 */
export async function detectActionOpportunities(fileId: string): Promise<ActionOpportunity[]> {
  return post<ActionOpportunity[]>(
    `/api/recordings/files/${fileId}/action-opportunities/detect`,
  ).catch(silent)
}

/**
 * 行动机会列表
 * GET /api/recordings/action-opportunities
 */
export async function listActionOpportunities(): Promise<ActionOpportunity[]> {
  return get<ActionOpportunity[]>('/api/recordings/action-opportunities').catch(silent)
}

/**
 * 行动机会详情
 * GET /api/recordings/action-opportunities/{opportunity_id}
 */
export async function getActionOpportunity(opportunityId: string): Promise<ActionOpportunity> {
  return get<ActionOpportunity>(`/api/recordings/action-opportunities/${opportunityId}`).catch(silent)
}

/**
 * 从机会创建行动计划（LLM 生成草稿）
 * POST /api/recordings/action-opportunities/{opportunity_id}/plans
 * 409 = 机会状态不允许（已创建过计划/已忽略）；422 = 计划生成失败
 */
export async function createActionPlan(opportunityId: string): Promise<ActionPlan> {
  return post<ActionPlan>(`/api/recordings/action-opportunities/${opportunityId}/plans`).catch(silent)
}

/** 兼容旧版 dismissed 状态与新版回收站标记。 */
export function isActionOpportunityDismissed(opportunity: ActionOpportunity): boolean {
  return opportunity.status === 'dismissed' || opportunity.is_trashed === true
}

/** 从同一机会的计划中优先选取仍有效的版本。 */
export function selectActionPlan(plans: ActionPlan[]): ActionPlan | null {
  const visible = plans.filter((plan) => plan.is_trashed !== true)
  return visible.find((plan) => plan.status !== 'superseded') || visible[0] || null
}

/**
 * 行动计划列表（含 action_summary 执行摘要投影）
 * GET /api/recordings/action-plans
 */
export async function listActionPlans(): Promise<ActionPlan[]> {
  return get<ActionPlan[]>('/api/recordings/action-plans').catch(silent)
}

/**
 * 按机会定位计划。旧版列表包含已验收行动，新版默认列表不含归档项；
 * 找不到时才访问新版全量分页，兼容旧服务返回数组的情况。
 */
export async function findActionPlanByOpportunity(opportunityId: string): Promise<ActionPlan | null> {
  const activePlans = await listActionPlans()
  const mine = activePlans.filter((plan) => plan.opportunity_id === opportunityId && plan.is_trashed !== true)
  const active = mine.find((plan) => plan.status !== 'superseded')
  if (active) return active
  const supersededFallback = mine[0] || null

  const pageSize = 100
  for (let page = 1; page <= 50; page += 1) {
    let response: ActionPlan[] | { items: ActionPlan[]; total: number }
    try {
      response = await get<ActionPlan[] | { items: ActionPlan[]; total: number }>(
        '/api/actions/plans',
        { params: { status: 'all_with_trash', page, page_size: pageSize } },
      ).catch(silent)
    } catch {
      // 旧部署可能尚未支持分页过滤，此时保留原有“未找到”的提示。
      return supersededFallback
    }
    const plans = Array.isArray(response) ? response : response.items
    const result = selectActionPlan(plans.filter((plan) =>
      plan.opportunity_id === opportunityId && plan.status !== 'superseded',
    ))
    if (result) return result
    if (Array.isArray(response) || plans.length === 0 || page * pageSize >= response.total) {
      break
    }
  }
  return supersededFallback
}

/**
 * 行动计划详情
 * GET /api/recordings/action-plans/{plan_id}
 */
export async function getActionPlan(planId: string): Promise<ActionPlan> {
  return get<ActionPlan>(`/api/recordings/action-plans/${planId}`).catch(silent)
}

/**
 * 更新行动计划（仅 draft 可编辑；编辑已确认计划产生新草稿）
 * PATCH /api/recordings/action-plans/{plan_id}
 */
export async function updateActionPlan(
  planId: string,
  data: UpdateActionPlanRequest,
): Promise<ActionPlan> {
  return patch<ActionPlan>(`/api/recordings/action-plans/${planId}`, data).catch(silent)
}

/**
 * 确认行动计划：计划转 confirmed，创建 Action 并启动首个执行 Run
 * POST /api/recordings/action-plans/{plan_id}/confirm
 */
export async function confirmActionPlan(planId: string, supplementalInfo = ''): Promise<ActionPlanConfirmation> {
  return post<ActionPlanConfirmation>(`/api/recordings/action-plans/${planId}/confirm`, {
    supplemental_info: supplementalInfo.trim(),
  }).catch(silent)
}

/**
 * 行动结果列表（已验收成果）
 * GET /api/recordings/action-results
 */
export async function listActionResultAssets(): Promise<ActionResultAsset[]> {
  return get<ActionResultAsset[]>('/api/recordings/action-results').catch(silent)
}

/**
 * 行动结果详情
 * GET /api/recordings/action-results/{result_asset_id}
 */
export async function getActionResultAsset(resultAssetId: string): Promise<ActionResultAsset> {
  return get<ActionResultAsset>(`/api/recordings/action-results/${resultAssetId}`).catch(silent)
}

/**
 * 执行详情
 * GET /api/recordings/action-runs/{run_id}
 */
export async function getActionRun(runId: string): Promise<ActionRun> {
  return get<ActionRun>(`/api/recordings/action-runs/${runId}`).catch(silent)
}

/**
 * 执行回放（事件流快照，用于断线恢复或历史查看）
 * GET /api/recordings/action-runs/{run_id}/replay
 */
export async function getActionRunReplay(
  runId: string,
  params?: { after_seq?: number; limit?: number },
): Promise<ActionRunReplay> {
  return get<ActionRunReplay>(`/api/recordings/action-runs/${runId}/replay`, { params }).catch(silent)
}

/**
 * 取消执行（仅 queued/running 可取消）
 * POST /api/recordings/action-runs/{run_id}/cancel
 */
export async function cancelActionRun(runId: string): Promise<ActionRun> {
  return post<ActionRun>(`/api/recordings/action-runs/${runId}/cancel`).catch(silent)
}

/**
 * 重试执行（失败/取消后发起新一轮 Run）
 * POST /api/recordings/action-runs/{run_id}/retry
 */
export async function retryActionRun(runId: string): Promise<ActionRunStart> {
  return post<ActionRunStart>(`/api/recordings/action-runs/${runId}/retry`).catch(silent)
}

/**
 * 验收执行：生成行动成果，Action 转 accepted（幂等）
 * POST /api/recordings/action-runs/{run_id}/accept
 */
export async function acceptActionRun(runId: string): Promise<ActionResultAsset> {
  return post<ActionResultAsset>(`/api/recordings/action-runs/${runId}/accept`).catch(silent)
}

/**
 * 返工执行：基于原计划 + 反馈生成新 Run
 * POST /api/recordings/action-runs/{run_id}/refine
 * 409 = 已有返工在执行中（refinement_already_running）
 */
export async function refineActionRun(runId: string, feedback?: string): Promise<ActionRunStart> {
  return post<ActionRunStart>(`/api/recordings/action-runs/${runId}/refine`, {
    feedback: feedback ?? '',
  }).catch(silent)
}

/**
 * 下载执行产物（文件流，需登录态；返回 blob 由调用方触发保存）
 * GET /api/recordings/action-runs/{run_id}/artifacts/{artifact_id}/download
 *
 * 注意：blob 响应不走 config 的信封解包包装（会把 Blob 解成 undefined），
 * 这里用原始 axios 实例，其响应拦截器对 blob 直接返回 response.data（即 Blob）。
 */
export async function downloadActionArtifact(runId: string, artifactId: string): Promise<Blob> {
  const res = await request
    .get<Blob>(`/api/recordings/action-runs/${runId}/artifacts/${artifactId}/download`, {
      responseType: 'blob',
    })
    .catch(silent)
  return res as unknown as Blob
}

/**
 * 预览执行产物（PDF 流；返回 blob 由调用方打开）
 * GET /api/recordings/action-runs/{run_id}/artifacts/{artifact_id}/preview
 */
export async function previewActionArtifact(runId: string, artifactId: string): Promise<Blob> {
  const res = await request
    .get<Blob>(`/api/recordings/action-runs/${runId}/artifacts/${artifactId}/preview`, {
      responseType: 'blob',
    })
    .catch(silent)
  return res as unknown as Blob
}

/**
 * 从 axios 错误中提取后端 message
 */
export function extractActionErrorMessage(error: any, fallback: string): string {
  const msg = error?.response?.data?.message || error?.message
  return typeof msg === 'string' && msg ? msg : fallback
}

const recordingActionApi = {
  listActionItems,
  getActionItem,
  detectActionOpportunities,
  listActionOpportunities,
  getActionOpportunity,
  createActionPlan,
  listActionPlans,
  findActionPlanByOpportunity,
  isActionOpportunityDismissed,
  getActionPlan,
  updateActionPlan,
  confirmActionPlan,
  listActionResultAssets,
  getActionResultAsset,
  getActionRun,
  getActionRunReplay,
  cancelActionRun,
  retryActionRun,
  acceptActionRun,
  refineActionRun,
  downloadActionArtifact,
  previewActionArtifact,
}

export default recordingActionApi
