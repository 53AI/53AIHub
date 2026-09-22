/**
 * 复用共享 @/api/modules/system-log 的类型，避免重复声明
 */
export type {
  SystemLogItem,
  SystemLogDisplayItem,
  SystemLogListResponse,
  ActionItem,
  ModuleItem,
} from '@/api/modules/system-log/types'

/**
 * 列表请求参数（保留模块名保持调用契约一致）
 */
export type { SystemLogListRequest as SystemLogListParams } from '@/api/modules/system-log/types'
