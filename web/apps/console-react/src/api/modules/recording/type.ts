/**
 * 录音管理后台相关类型定义
 */

/**
 * 历史记忆抽取实体类型
 * 与后端 /api/recordings/memories/schema 返回的 entity_type 对齐：
 * 仅保留人物/事项/原则/风险 4 类，Commitment/RedLine/Disagreement 已下线。
 *
 * 存储层使用首字母大写形式（与历史 config 兼容），前端通过小写 schema key 映射回来。
 */
export type MemoryExtractionType = "Person" | "Matter" | "Principle" | "Risk";

/** 历史记忆抽取配置 */
export interface MemoryExtractionConfig {
  enabled: boolean;
  types: MemoryExtractionType[];
}

/** 历史记忆抽取类型 → 中文 label 映射（来自 schema） */
export type MemoryExtractionLabels = Partial<Record<MemoryExtractionType, string>>;

/**
 * schema 端 entity_type → 中文 label（小写 key，跟接口契约一致）。
 * 这里只关心 label，不关心 attributes —— 历史记忆设置面板只用到类型名。
 */
export interface MemoryEntityTypeSchema {
  label: string;
}

export type MemoryEntityTypeSchemas = Record<string, MemoryEntityTypeSchema>;

/** 录音配置 */
export interface RecordingConfig {
  enabled: boolean;
  parser_platform: string;
  voice_model_id: number;
  voice_model_name: string;
  inference_model_id: number;
  inference_model_name: string;
  recording_agent_enabled?: boolean;
  multi_perspective_enabled?: boolean;
  insight_regenerate_enabled?: boolean;
  memory_extraction?: MemoryExtractionConfig;
}

/** 更新录音配置请求体 */
export interface UpdateRecordingConfigRequest {
  enabled?: boolean;
  parser_platform?: string;
  voice_model_id?: number;
  voice_model_name?: string;
  inference_model_id?: number;
  inference_model_name?: string;
  recording_agent_enabled?: boolean;
  multi_perspective_enabled?: boolean;
  insight_regenerate_enabled?: boolean;
  memory_extraction?: MemoryExtractionConfig;
}

/** 模板项 */
export interface TemplateItem {
  id?: string;
  name: string;
  category: string;
  description: string;
  instruction?: string;
}

/** 解析平台 */
export interface ParserPlatform {
  platform_key: string;
  display_name: string;
  configured: boolean;
  status: string;
}

/** 解析平台列表响应 */
export interface ParserPlatformsData {
  platforms: ParserPlatform[];
}

/** 录音文件列表项 */
export interface RecordingItem {
  id: number;
  name: string;
  creator_id: number;
  creator_name: string;
  file_size: number;
  duration: number;
  created_time: number;
  updated_time: number;
  status: string;
}

/** 录音文件转换状态枚举 */
export enum RecordingStatus {
  NORMAL = "normal",
  PENDING = "pending",
  CONVERTING = "converting",
  FAILED = "failed",
  INACTIVE = "inactive",
}

/** 录音列表请求参数 */
export interface RecordingListRequest {
  user_ids?: string;
  keyword?: string;
  start_time?: number;
  end_time?: number;
  group_id?: number;
  sort_by?: 'created_time' | 'updated_time';
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

/** 录音列表响应数据 */
export interface RecordingListData {
  items: RecordingItem[];
  total: number;
  offset: number;
  limit: number;
}

/** 录音统计请求参数 */
export interface RecordingStatsRequest {
  user_ids?: string;
  start_time?: number;
  end_time?: number;
}

/** 录音统计数据 */
export interface RecordingStats {
  total_count: number;
  total_file_size: number;
  total_duration: number;
}

/** 录音统计展示数据（已格式化） */
export interface RecordingStatsDisplay {
  total_count: number;
  total_file_size: {
    value: string;
    unit: string;
  };
  total_duration: {
    value: string;
    unit: string;
  };
}

/** 录音列表项展示格式 */
export interface RecordingItemDisplay {
  id: number;
  name: string;
  file_size: {
    value: string;
    unit: string;
  };
  duration: string;
  creator_name: string;
  created_time: string;
  status: string;
}

/** 录音列表展示响应数据 */
export interface RecordingListDataDisplay {
  items: RecordingItemDisplay[];
  total: number;
  offset: number;
  limit: number;
}

// ============== 解析进度统计 ==============

export interface ParsingCountItem {
  user_id: number;
  parsing_count: number;
}

export interface ParsingCountData {
  user_counts: ParsingCountItem[];
}

// ============== 总结模板 ==============

export interface RecordingSummaryTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  group_id: number;
  created_time: number;
  updated_time: number;
}

export interface SummaryTemplateRequest {
  name: string;
  description: string;
  prompt: string;
  group_id?: number;
}

// ============== 文件总结 ==============

export interface RecordingFileSummary {
  id: string;
  file_id: string;
  template_id: string;
  template_name: string;
  inference_model_id: number;
  summary_content: string;
  created_time: number;
  updated_time: number;
}

// ============== 录音文件分组 ==============

export interface RecordingFileGroup {
  group_id: number;
  group_name: string;
  created_time: number;
  updated_time: number;
}

export interface CreateRecordingFileGroupRequest {
  group_name: string;
}
