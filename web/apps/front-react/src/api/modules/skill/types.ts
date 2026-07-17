// ========== 枚举类型 ==========

/** 发布状态 */
export const PublishStatus_TYPE = {
  draft: 'draft',
  published: 'published',
  rejected: 'rejected',
} as const
export type PublishStatus = typeof PublishStatus_TYPE[keyof typeof PublishStatus_TYPE];

/** 管理状态 */
export const AdminStatus_TYPE = {
  enabled: 'enabled',
  disabled: 'disabled',
} as const
export type AdminStatus = typeof AdminStatus_TYPE[keyof typeof AdminStatus_TYPE];

/** 风险等级 */
export const RiskLevel_TYPE = {
  low: 'low',
  medium: 'medium',
  high: 'high',
} as const
export type RiskLevel = typeof RiskLevel_TYPE[keyof typeof RiskLevel_TYPE];

/** 绑定状态 */
export const BindingStatus_TYPE = {
  enabled: 'enabled',
  disabled: 'disabled',
  empty: '',
} as const
export type BindingStatus = typeof BindingStatus_TYPE[keyof typeof BindingStatus_TYPE];

/** 来源类型 */
export const SourceType_TYPE = {
  zip: 'zip',
  github: 'github',
  platform: 'platform',
} as const
export type SourceType = typeof SourceType_TYPE[keyof typeof SourceType_TYPE];

/** 扫描任务状态 */
export const ScanJobStatus_TYPE = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failed: 'failed',
} as const
export type ScanJobStatus = typeof ScanJobStatus_TYPE[keyof typeof ScanJobStatus_TYPE];

/** AI生成类型 */
export const GenerationType_TYPE = {
  capabilities: 'capabilities',   // 能做什么
  usage_example: 'usage_example', //使用示例
  best_practice: 'best_practice', //最佳实践
  faq: 'faq',  //常见问题
  document_summary: 'document_summary', //文档摘要
} as const
export type GenerationType = typeof GenerationType_TYPE[keyof typeof GenerationType_TYPE];

// ========== 数据模型 ==========

/** 技能基础信息 */
export interface SkillPublic {
  id: string;                    // HashID
  eid: number;
  logo: string
  source_type: SourceType;
  skill_name: string;
  sort: number;
  display_name: string;
  description: string;
  version: string;
  usage_guide: string;
  origin_zip_name: string;
  origin_zip_size: number;
  origin_zip_sha256: string;
  publish_status: PublishStatus;
  admin_status: AdminStatus;
  risk_level: RiskLevel;
  score_integrity: number;
  score_practicality: number;
  score_safety: number;
  score_code_quality: number;
  score_doc_quality: number;
  scan_message: string;
  created_time: number;
  updated_time: number;
  group_ids: number[]
}

export interface Skill extends SkillPublic {
  binding_id: string;
  added: boolean;
  binding_status: BindingStatus;
}

/** 探索列表项（不再返回 binding 相关字段） */
export interface SkillExploreItem extends SkillPublic {
  // 已废弃字段：binding_id、added、binding_status
}

/** 技能详情（不再返回 binding 相关字段） */
export interface SkillDetail extends SkillPublic {
  // 已废弃字段：binding_id、added、binding_status
  env_vars?: SkillEnvVarTemplate[];
  group_id?: number;
}

// ========== Agent 技能绑定相关 ==========

/**
 * Agent 技能绑定项
 * 对应 GET /api/agent/:agent_id/skills 返回的 items 中的每一项
 */
export interface AgentSkillBindingItem {
  id: string;                    // 技能ID（HashID）
  binding_id: number;
  skill_library_id: number;      // 技能库ID
  bind_type: 'builtin' | 'user';
  status: 'enabled' | 'disabled';
  skill_name: string;
  display_name: string;
  description: string;
  version: string;
  logo: string;
  publish_status: PublishStatus;
  admin_status: AdminStatus;
  risk_level: RiskLevel;
  created_time: number;
  updated_time: number;
}

/** 技能环境变量模板（企业级 key 列表） */
export interface SkillEnvVarTemplate {
  key: string;
  sensitive: boolean;
}

/** 我的技能环境变量 */
export interface SkillEnvVarItem {
  id: string;
  key: string;
  value: string;
  sensitive: boolean;
}

/** 我的技能列表项 */
export interface SkillMyItem extends Omit<SkillPublic, 'id'> {
  binding_id: string;
  id: string;                    // skill_library_id
  binding_status: BindingStatus;
}

/** 扫描任务 */
export interface SkillScanJob {
  id: string;
  eid: number;
  skill_library_id: string;
  status: ScanJobStatus;
  risk_level: RiskLevel;
  score_integrity: number;
  score_practicality: number;
  score_safety: number;
  score_code_quality: number;
  score_doc_quality: number;
  message: string;
  scan_model: string;
  retry_count: number;
  started_time: number;
  finished_time: number;
}

/** 后台技能详情 */
export interface AdminSkillDetail {
  skill: SkillPublic;
  latest_scan_job?: SkillScanJob;
  permission_group_ids: number[];
}

// ========== 请求参数 ==========

/** 探索列表查询 */
export interface SkillExploreQuery {
  keyword?: string;
  offset?: number;
  limit?: number;
  group_id?: number;
}

/** 后台列表查询 */
export interface AdminSkillListQuery {
  keyword?: string;
  publish_status?: PublishStatus;
  admin_status?: AdminStatus;
  group_id?: number;
  offset?: number;
  limit?: number;
}

/** 导入技能请求 */
export interface AdminImportSkillRequest {
  source_type: 'zip' | 'github';
  upload_file_id?: string;
  github_url?: string;
  ref?: string;
  group_ids?: number[];
  subscription_group_ids?: number[];
  user_group_ids?: number[];
}

/** 更新技能请求 */
export interface AdminUpdateSkillRequest {
  display_name?: string;
  description?: string;
  usage_guide?: string;
  version?: string;
  sort?: number;
  admin_status?: AdminStatus;
  group_ids?: number[];
  subscription_group_ids?: number[];
  user_group_ids?: number[];
}

/** 更新状态请求 */
export interface AdminUpdateStatusRequest {
  publish_status?: PublishStatus;
  admin_status?: AdminStatus;
}

/** 启停我的技能请求 */
export interface UpdateMySkillStatusRequest {
  status: 'enabled' | 'disabled';
}

/** AI生成请求 */
export interface AdminAIGenerateRequest {
  generation_type: GenerationType;
  skill_md?: string;
  document?: string;
  title_max_chars?: number;
  description_max_chars?: number;
  question_max_chars?: number;
  answer_max_chars?: number;
  case_max_chars?: number;
  target_chars?: number;
}

// ========== 响应数据 ==========

/** 通用响应 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

/** 分页响应 */
export interface PagedResponse<T> {
  count: number;
  items: T[];
}

/** 导入响应 */
export interface ImportSkillResponse {
  skill_id: string;
  skill_name: string;
  scan_job_id: string;
  status: ScanJobStatus;
}

/** AI生成响应（文本） */
export interface AIGenerateTextResponse {
  generation_type: GenerationType;
  content: string;
}

/** AI生成响应（问答） */
export interface AIGenerateQaResponse {
  generation_type: 'qa';
  qa_list: Array<{
    question: string;
    answer: string;
  }>;
}

/** AI生成响应联合类型 */
export type AIGenerateResponse = AIGenerateTextResponse | AIGenerateQaResponse;
