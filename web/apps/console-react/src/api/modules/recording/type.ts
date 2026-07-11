/**
 * 录音管理后台相关类型定义
 */

/** 录音配置 */
export interface RecordingConfig {
  enabled: boolean;
  parser_platform: string;
}

/** 更新录音配置请求体 */
export interface UpdateRecordingConfigRequest {
  enabled: boolean;
  parser_platform?: string;
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
  duration: number; // 时长（毫秒）
  created_time: number;
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
    value: string; // 格式化后的值，一位小数
    unit: string;  // 单位：B、KB、MB、GB
  };
  total_duration: {
    value: string; // 格式化后的值，一位小数
    unit: string;  // 单位：秒、分钟、小时
  };
}

/** 录音列表项展示格式 */
export interface RecordingItemDisplay {
  id: number;
  name: string;
  file_size: {
    value: string; // 格式化后的值，一位小数
    unit: string;  // 单位：B、KB、MB、GB
  };
  duration: string; // 格式化后的时长，如 "01:23:45"
  creator_name: string;
  created_time: string; // 格式化后的时间
  status: string;
}

/** 录音列表展示响应数据 */
export interface RecordingListDataDisplay {
  items: RecordingItemDisplay[];
  total: number;
  offset: number;
  limit: number;
}
