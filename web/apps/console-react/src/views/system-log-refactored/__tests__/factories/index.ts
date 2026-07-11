/**
 * 测试数据工厂
 * 提供统一的测试数据创建函数
 */
import type {
  SystemLogItem,
  SystemLogDisplayItem,
  ActionItem,
  ModuleItem,
  SystemLogListResponse,
  SystemLogListParams,
} from '../../types'

/**
 * 自增 ID 计数器
 */
let idCounter = 0

/**
 * 重置 ID 计数器
 */
export function resetIdCounter(): void {
  idCounter = 0
}

/**
 * 生成唯一 ID
 */
function nextId(): number {
  return ++idCounter
}

/**
 * 默认值配置
 */
export const defaults = {
  systemLogItem: {
    id: () => nextId(),
    eid: () => 1,
    user_id: () => 1,
    nickname: () => '测试用户',
    module: () => 1,
    action: () => 1,
    content: () => '测试日志内容',
    ip: () => '127.0.0.1',
    action_time: () => Date.now(),
  },
  actionItem: {
    value: () => nextId(),
    text: () => '测试操作',
  },
  moduleItem: {
    value: () => nextId(),
    text: () => '测试模块',
  },
}

/**
 * 测试数据工厂
 */
export const factories = {
  /**
   * 创建系统日志项
   */
  systemLogItem(overrides: Partial<SystemLogItem> = {}): SystemLogItem {
    return {
      id: defaults.systemLogItem.id(),
      eid: defaults.systemLogItem.eid(),
      user_id: defaults.systemLogItem.user_id(),
      nickname: defaults.systemLogItem.nickname(),
      module: defaults.systemLogItem.module(),
      action: defaults.systemLogItem.action(),
      content: defaults.systemLogItem.content(),
      ip: defaults.systemLogItem.ip(),
      action_time: defaults.systemLogItem.action_time(),
      ...overrides,
    }
  },

  /**
   * 创建系统日志列表
   */
  systemLogList(count: number, overrides: Partial<SystemLogItem> = {}): SystemLogItem[] {
    return Array.from({ length: count }, () => factories.systemLogItem(overrides))
  },

  /**
   * 创建系统日志展示项
   */
  systemLogDisplayItem(overrides: Partial<SystemLogDisplayItem> = {}): SystemLogDisplayItem {
    const item = factories.systemLogItem()
    return {
      ...item,
      action_time: '2024-01-01 12:00',
      ...overrides,
    }
  },

  /**
   * 创建操作项
   */
  actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
    return {
      value: defaults.actionItem.value(),
      text: defaults.actionItem.text(),
      ...overrides,
    }
  },

  /**
   * 创建操作项列表
   */
  actionItemList(count: number): ActionItem[] {
    const actions = ['登录', '登出', '创建', '编辑', '删除', '查看', '导出', '导入']
    return Array.from({ length: count }, (_, index) =>
      factories.actionItem({
        value: index + 1,
        text: actions[index % actions.length],
      })
    )
  },

  /**
   * 创建模块项
   */
  moduleItem(overrides: Partial<ModuleItem> = {}): ModuleItem {
    return {
      value: defaults.moduleItem.value(),
      text: defaults.moduleItem.text(),
      ...overrides,
    }
  },

  /**
   * 创建模块项列表
   */
  moduleItemList(count: number): ModuleItem[] {
    const modules = ['用户管理', '系统设置', '日志管理', '权限管理', '数据管理']
    return Array.from({ length: count }, (_, index) =>
      factories.moduleItem({
        value: index + 1,
        text: modules[index % modules.length],
      })
    )
  },

  /**
   * 创建列表响应
   */
  listResponse(options: {
    itemCount?: number
    total?: number
  } = {}): SystemLogListResponse {
    const { itemCount = 10, total = itemCount } = options
    return {
      system_logs: factories.systemLogList(itemCount),
      count: total,
    }
  },

  /**
   * 创建默认请求参数
   */
  defaultListParams(): SystemLogListParams {
    return {
      offset: 0,
      limit: 10,
      user_id: null,
      start_time: null,
      end_time: null,
      module: undefined,
      action: undefined,
    }
  },
}

/**
 * 预设场景
 */
export const scenarios = {
  /**
   * 空数据场景
   */
  empty(): SystemLogListResponse {
    return { system_logs: [], count: 0 }
  },

  /**
   * 最小数据场景
   */
  minimal(): SystemLogListResponse {
    return factories.listResponse({ itemCount: 1 })
  },

  /**
   * 标准场景
   */
  standard(): SystemLogListResponse {
    return factories.listResponse({ itemCount: 10, total: 100 })
  },

  /**
   * 大数据量场景
   */
  large(): SystemLogListResponse {
    return factories.listResponse({ itemCount: 50, total: 1000 })
  },
}

export default factories
