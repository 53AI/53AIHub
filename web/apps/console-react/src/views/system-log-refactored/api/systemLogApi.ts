/**
 * System Log API 封装
 * 提供可测试的 API 层，支持依赖注入
 */
import { systemLogApi as originalApi } from '@/api/modules/system-log'
import { getSimpleDateFormatString } from '@km/shared-utils'
import type {
  SystemLogItem,
  SystemLogDisplayItem,
  SystemLogListParams,
  SystemLogListResponse,
  SystemLogCreateRequest,
  ActionItem,
  ModuleItem,
} from '../types'

/**
 * API 接口定义（便于 mock）
 */
export interface SystemLogApiInterface {
  list: (params: SystemLogListParams) => Promise<SystemLogListResponse>
  create: (data: SystemLogCreateRequest) => Promise<void>
  actions: () => Promise<ActionItem[]>
  modules: () => Promise<ModuleItem[]>
}

/**
 * 转换日志项为展示格式
 */
export function transformSystemLogItem(item: SystemLogItem): SystemLogDisplayItem {
  return {
    ...item,
    action_time: getSimpleDateFormatString({
      date: item.action_time,
      format: 'YYYY-MM-DD hh:mm',
    }),
  }
}

/**
 * 转换日志列表
 */
export function transformSystemLogList(items: SystemLogItem[]): SystemLogDisplayItem[] {
  return items.map(transformSystemLogItem)
}

/**
 * 获取默认请求参数
 */
export function getDefaultListParams(): SystemLogListParams {
  return {
    offset: 0,
    limit: 10,
    user_id: null,
    start_time: null,
    end_time: null,
    module: undefined,
    action: undefined,
  }
}

/**
 * 默认 API 实现
 */
export const systemLogApi: SystemLogApiInterface = {
  async list(params: SystemLogListParams): Promise<SystemLogListResponse> {
    return originalApi.list(params)
  },

  async create(data: SystemLogCreateRequest): Promise<void> {
    await originalApi.create(data)
  },

  async actions(): Promise<ActionItem[]> {
    return originalApi.actions()
  },

  async modules(): Promise<ModuleItem[]> {
    return originalApi.modules()
  },
}

/**
 * 创建可注入的 API 实例（用于测试）
 */
export function createSystemLogApi(
  overrides: Partial<SystemLogApiInterface> = {}
): SystemLogApiInterface {
  return {
    ...systemLogApi,
    ...overrides,
  }
}

export default systemLogApi
