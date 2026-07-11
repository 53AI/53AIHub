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
}

/** 探索列表项 */
// export interface SkillExploreItem extends SkillPublic {
//   binding_id: string;
//   added: boolean;
//   binding_status: BindingStatus;
// }

/** 技能详情 */
export interface SkillDetail extends SkillPublic {
  // 已废弃字段：binding_id、added、binding_status
}

// ========== Agent 技能绑定相关 ==========

/**
 * Agent 技能绑定项
 * 对应 GET /api/agent/:agent_id/skills 返回的 items 中的每一项
 */
export interface AgentSkillBindingItem {
  binding_id: number;
  skill_id: string;              // 技能ID（HashID）
  skill_library_id: number;      // 技能库ID（用于 add/delete API）
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

/** 探索列表查询 */
export interface SkillExploreQuery {
  keyword?: string;
  offset?: number;
  limit?: number;
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

// ========== 技能文件相关 ==========

/** 文件类型枚举 */
export type SkillFileType = 'file' | 'directory';

/** 文件树节点（后端返回格式） */
export interface SkillFileItem {
  name: string;                          // 文件/目录名
  path: string;                          // 相对路径（正斜杠分隔）
  type: SkillFileType;                   // file 或 directory
  size?: number;                         // 文件大小（字节），仅文件类型
  modified_time?: number;                // 修改时间戳（秒），仅文件类型
  children?: SkillFileItem[];            // 子节点，仅目录类型
}

/** 文件更新项 */
export interface SkillFileUpdateItem {
  path: string;                          // 文件相对路径（必填）
  content: string;                       // 文件内容（必填）
}

/** 文件更新请求 */
export interface SkillFileUpdateRequest {
  files?: SkillFileUpdateItem[];        // 要更新/创建的文件列表
  deleted_files?: string[];             // 要删除的文件路径列表
}

/** 文件更新结果 */
export interface SkillFileUpdateResult {
  updated_count: number;                // 成功更新的文件数
  deleted_count: number;                // 成功删除的文件数
  repackaged: boolean;                  // 是否已重新打包
  new_zip_key: string;                  // 新包的存储路径
}

/** 文件内容响应（后端返回格式） */
export interface SkillFileContentResult {
  path: string;                         // 文件相对路径
  content: string;                      // 文件内容
  size: number;                        // 文件大小（字节）
}

/** 技能文件列表响应 */
export interface SkillFileListResponse {
  files: SkillFileItem[];
}

// ========== 技能环境变量相关 ==========

/** 环境变量 */
export interface SkillEnvVar {
  id: string;         // HashID，如 "PQNMcn"
  key: string;        // 环境变量名，如 "API_KEY"
  value: string;      // 值（敏感字段返回 "***"）
  sensitive: boolean; // 是否敏感
}

/** 环境变量列表响应 */
export interface SkillEnvVarListData {
  items: SkillEnvVar[];
}

/** 创建环境变量请求 */
export interface CreateSkillEnvVarRequest {
  key: string;         // 必填
  value?: string;      // 可选，默认 ""
  sensitive?: boolean; // 可选，默认 false
}

/** 更新环境变量请求（所有字段可选，只传需要改的） */
export interface UpdateSkillEnvVarRequest {
  key?: string;
  value?: string;
  sensitive?: boolean;
}

/** 批量替换环境变量请求 */
export interface BatchUpdateSkillEnvVarsRequest {
  items: CreateSkillEnvVarRequest[];
}

/** 强制导入高风险技能请求 */
export interface ForceImportSkillRequest {
  scan_job_id: string;
}