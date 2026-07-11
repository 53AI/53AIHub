/**
 * 测试数据工厂
 * 提供统一的测试数据创建函数，支持覆盖默认值
 *
 * @example
 * // 创建单个工具项
 * const item = factories.aiLinkItem({ name: 'Custom Name' })
 *
 * // 创建批量数据
 * const items = factories.aiLinkList(10)
 *
 * // 创建带子项的分组
 * const group = factories.groupOption({ children: factories.aiLinkList(3) })
 */
import type {
  AiLinkItem,
  GroupOption,
  RawGroupOption,
  SharedAccountItem,
  SortItem,
  AiLinkDetail,
} from '../../types'

/**
 * 自增 ID 计数器
 */
let idCounter = 0

/**
 * 重置 ID 计数器（每个测试前调用）
 */
export function resetIdCounter(): void {
  idCounter = 0
}

/**
 * 生成唯一 ID
 */
function nextId(): string {
  return `test-${++idCounter}`
}

/**
 * 默认值配置
 */
export const defaults = {
  aiLinkItem: {
    ai_link_id: () => nextId(),
    name: () => 'Test Tool',
    description: () => 'Test Description',
    logo: () => 'https://example.com/logo.png',
    url: () => 'https://example.com',
    group_id: () => 1,
    sort: () => 1,
    shared_account: () => undefined,
    user_group_ids: () => undefined,
    subscription_group_ids: () => undefined,
  },
  groupOption: {
    group_id: () => 1,
    group_name: () => 'Test Group',
    children: () => [],
  },
  rawGroupOption: {
    group_id: () => 1,
    group_name: () => 'Test Group',
    sort: () => 1,
  },
  sharedAccountItem: {
    account: () => 'test@example.com',
    password: () => 'password123',
    remark: () => undefined,
  },
  sortItem: {
    group_id: () => 1,
    id: () => nextId(),
    sort: () => 1,
  },
  aiLinkDetail: {
    ai_link_id: () => nextId(),
    name: () => 'Test Tool',
    url: () => 'https://example.com',
    description: () => 'Test Description',
    logo: () => 'https://example.com/logo.png',
    group_id: () => 1,
    sort: () => 1,
  },
}

/**
 * 测试数据工厂对象
 */
export const factories = {
  /**
   * 创建 AI 工具项
   * @example
   * factories.aiLinkItem() // 使用默认值
   * factories.aiLinkItem({ name: 'ChatGPT', group_id: 2 }) // 覆盖部分值
   */
  aiLinkItem(overrides: Partial<AiLinkItem> = {}): AiLinkItem {
    return {
      ai_link_id: defaults.aiLinkItem.ai_link_id(),
      name: defaults.aiLinkItem.name(),
      description: defaults.aiLinkItem.description(),
      logo: defaults.aiLinkItem.logo(),
      url: defaults.aiLinkItem.url(),
      group_id: defaults.aiLinkItem.group_id(),
      sort: defaults.aiLinkItem.sort(),
      ...overrides,
    }
  },

  /**
   * 创建 AI 工具列表
   * @param count 数量
   * @param overrides 每项的覆盖值（可选）
   * @example
   * factories.aiLinkList(5) // 5 个默认工具
   * factories.aiLinkList(3, { group_id: 2 }) // 3 个 group_id=2 的工具
   */
  aiLinkList(count: number, overrides: Partial<AiLinkItem> = {}): AiLinkItem[] {
    return Array.from({ length: count }, (_, index) =>
      this.aiLinkItem({
        ...overrides,
        sort: index + 1,
      })
    )
  },

  /**
   * 创建分组选项（带子项）
   * @example
   * factories.groupOption() // 空分组
   * factories.groupOption({ children: factories.aiLinkList(3) }) // 带 3 个工具
   */
  groupOption(overrides: Partial<GroupOption> = {}): GroupOption {
    return {
      group_id: defaults.groupOption.group_id(),
      group_name: defaults.groupOption.group_name(),
      children: defaults.groupOption.children(),
      ...overrides,
    }
  },

  /**
   * 创建分组列表
   * @param count 分组数量
   * @param childrenPerGroup 每个分组的工具数量
   * @example
   * factories.groupOptionList(3, 2) // 3 个分组，每组 2 个工具
   */
  groupOptionList(count: number, childrenPerGroup = 0): GroupOption[] {
    return Array.from({ length: count }, (_, index) =>
      this.groupOption({
        group_id: index + 1,
        group_name: `Group ${index + 1}`,
        children: this.aiLinkList(childrenPerGroup, { group_id: index + 1 }),
      })
    )
  },

  /**
   * 创建原始分组选项（用于 GroupTabs）
   */
  rawGroupOption(overrides: Partial<RawGroupOption> = {}): RawGroupOption {
    return {
      group_id: defaults.rawGroupOption.group_id(),
      group_name: defaults.rawGroupOption.group_name(),
      sort: defaults.rawGroupOption.sort(),
      ...overrides,
    }
  },

  /**
   * 创建原始分组列表
   */
  rawGroupOptionList(count: number): RawGroupOption[] {
    return Array.from({ length: count }, (_, index) =>
      this.rawGroupOption({
        group_id: index + 1,
        group_name: `Group ${index + 1}`,
        sort: index + 1,
      })
    )
  },

  /**
   * 创建共享账号项
   */
  sharedAccountItem(overrides: Partial<SharedAccountItem> = {}): SharedAccountItem {
    return {
      account: defaults.sharedAccountItem.account(),
      password: defaults.sharedAccountItem.password(),
      ...overrides,
    }
  },

  /**
   * 创建共享账号列表
   */
  sharedAccountList(count: number): SharedAccountItem[] {
    return Array.from({ length: count }, (_, index) =>
      this.sharedAccountItem({
        account: `user${index + 1}@example.com`,
        password: `password${index + 1}`,
      })
    )
  },

  /**
   * 创建排序项
   */
  sortItem(overrides: Partial<SortItem> = {}): SortItem {
    return {
      group_id: defaults.sortItem.group_id(),
      id: defaults.sortItem.id(),
      sort: defaults.sortItem.sort(),
      ...overrides,
    }
  },

  /**
   * 创建排序项列表
   */
  sortItemList(count: number, groupId = 1): SortItem[] {
    return Array.from({ length: count }, (_, index) =>
      this.sortItem({
        group_id: groupId,
        sort: count - index, // 降序，符合业务逻辑
      })
    )
  },

  /**
   * 创建 AI 工具详情（用于创建/编辑页面）
   */
  aiLinkDetail(overrides: Partial<AiLinkDetail> = {}): AiLinkDetail {
    return {
      ai_link_id: defaults.aiLinkDetail.ai_link_id(),
      name: defaults.aiLinkDetail.name(),
      url: defaults.aiLinkDetail.url(),
      description: defaults.aiLinkDetail.description(),
      logo: defaults.aiLinkDetail.logo(),
      group_id: defaults.aiLinkDetail.group_id(),
      sort: defaults.aiLinkDetail.sort(),
      ...overrides,
    }
  },

  /**
   * 创建完整的测试场景数据
   * 包含分组、工具列表，用于集成测试
   */
  scenario(options: {
    groupCount?: number
    itemsPerGroup?: number
  } = {}): {
    groups: RawGroupOption[]
    items: AiLinkItem[]
    groupOptions: GroupOption[]
  } {
    const { groupCount = 2, itemsPerGroup = 3 } = options

    const groups = this.rawGroupOptionList(groupCount)
    const items: AiLinkItem[] = []

    groups.forEach((group) => {
      items.push(...this.aiLinkList(itemsPerGroup, { group_id: group.group_id }))
    })

    const groupOptions = groups.map((group) => ({
      group_id: group.group_id,
      group_name: group.group_name,
      children: items.filter((item) => item.group_id === group.group_id),
    }))

    return { groups, items, groupOptions }
  },
}

/**
 * 预设场景
 * 提供常用测试场景的快捷方法
 */
export const scenarios = {
  /**
   * 空数据场景
   */
  empty(): { groups: RawGroupOption[]; items: AiLinkItem[]; groupOptions: GroupOption[] } {
    return { groups: [], items: [], groupOptions: [] }
  },

  /**
   * 单分组单工具场景
   */
  minimal(): ReturnType<typeof factories.scenario> {
    return factories.scenario({ groupCount: 1, itemsPerGroup: 1 })
  },

  /**
   * 标准场景：2 分组，每组 3 工具
   */
  standard(): ReturnType<typeof factories.scenario> {
    return factories.scenario({ groupCount: 2, itemsPerGroup: 3 })
  },

  /**
   * 大数据量场景：5 分组，每组 20 工具
   */
  large(): ReturnType<typeof factories.scenario> {
    return factories.scenario({ groupCount: 5, itemsPerGroup: 20 })
  },

  /**
   * 超大数据量场景：10 分组，每组 100 工具（用于性能测试）
   */
  xlarge(): ReturnType<typeof factories.scenario> {
    return factories.scenario({ groupCount: 10, itemsPerGroup: 100 })
  },
}

export default factories
