// apps/front-react/src/components/InfiniteVirtualList/types.ts

/**
 * 分页请求参数
 */
export interface PaginationParams {
  offset: number
  limit: number
}

/**
 * useInfiniteScroll Hook 配置
 */
export interface UseInfiniteScrollOptions<T, R> {
  /** 数据源请求函数 */
  fetcher: (params: PaginationParams) => Promise<R>

  /** 从响应中提取数据列表 */
  extractItems: (response: R) => T[]

  /** 判断是否还有更多数据（可选，默认基于返回数量判断） */
  hasMore?: (response: R, items: T[], params: PaginationParams) => boolean

  /** 每页条数，默认 50 */
  pageSize?: number

  /** 初始偏移量，默认 0 */
  initialOffset?: number

  /** 数据去重 key（可选） */
  itemKey?: string | ((item: T) => string | number)
}

/**
 * useInfiniteScroll Hook 返回值
 */
export interface UseInfiniteScrollReturn<T> {
  /** 当前已加载的数据列表 */
  items: T[]

  /** 首次加载中 */
  loading: boolean

  /** 加载更多中 */
  loadingMore: boolean

  /** 是否还有更多数据 */
  hasMore: boolean

  /** 加载更多 */
  loadMore: () => Promise<void>

  /** 重新加载（从头开始） */
  reload: () => Promise<void>

  /** 重置状态 */
  reset: () => void
}

/**
 * 分组配置
 */
export interface GroupConfig<T> {
  /** 分组标题 */
  title: string

  /** 判断该项是否属于此分组 */
  match: (item: T) => boolean
}

/**
 * useGroupedList Hook 配置
 */
export interface UseGroupedListOptions<T> {
  /** 原始数据列表 */
  items: T[]

  /** 分组配置（按顺序匹配） */
  groups: GroupConfig<T>[]

  /** 是否启用分组，默认 true */
  enabled?: boolean
}

/**
 * 分组后的数据项
 */
export interface GroupedItem<T> {
  /** 类型：group 为分组标题，item 为数据项 */
  type: 'group' | 'item'

  /** 分组标题（type === 'group' 时有值） */
  group?: string

  /** 数据项（type === 'item' 时有值） */
  item?: T

  /** 分组索引，用于生成唯一 key */
  groupIndex?: number
}

/**
 * useGroupedList Hook 返回值
 */
export interface UseGroupedListReturn<T> {
  /** 转换后的扁平列表（包含分组标题和普通项） */
  groupedItems: GroupedItem<T>[]

  /** 每个 item 在原始列表中的索引 */
  getItemIndex: (groupedIndex: number) => number
}

/**
 * InfiniteVirtualList 组件属性
 */
export interface InfiniteVirtualListProps<T> {
  /** 数据列表（可以是扁平或分组后的） */
  items: T[]

  /** 每个 item 的高度，可以是固定值或函数 */
  itemHeight: number | ((item: T, index: number) => number)

  /** 生成 item 唯一 key 的方式 */
  itemKey?: string | ((item: T, index: number) => string | number)

  /** 渲染函数 */
  renderItem: (item: T, index: number) => React.ReactNode

  /** 加载更多中 */
  loadingMore?: boolean

  /** 是否还有更多数据 */
  hasMore?: boolean

  /** 加载更多回调 */
  onLoadMore?: () => void

  /** 自定义加载更多区域渲染 */
  renderLoadingMore?: () => React.ReactNode

  /** 自定义没有更多数据区域渲染 */
  renderNoMore?: () => React.ReactNode

  /** 滚动触发加载的距离阈值，默认 100px */
  loadThreshold?: number

  /** 容器类名 */
  className?: string

  /** 容器样式 */
  style?: React.CSSProperties

  /** 容器高度，默认 100% */
  height?: number | string
}