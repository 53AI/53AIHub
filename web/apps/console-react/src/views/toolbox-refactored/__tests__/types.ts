/**
 * 测试类型定义
 * 用于 mock 组件的类型安全
 */
import type { AiLinkItem } from '../types'
import type { SortableGroup, SortableRenderProps } from '@/components/SortableGroupGrid/types'

/**
 * Mock SortableGroupGrid Props
 */
export interface MockSortableGroupGridProps {
  groups: SortableGroup<AiLinkItem>[]
  renderItem: (item: AiLinkItem, handleProps?: SortableRenderProps<AiLinkItem>) => React.ReactNode
  onChange?: (groups: SortableGroup<AiLinkItem>[]) => void
}

/**
 * Mock GroupTabs Props
 */
export interface MockGroupTabsProps {
  value: (string | number)[]
  onChange: (ids: (string | number)[]) => void
  onOptionsChange?: (options: unknown[]) => void
}

/**
 * Mock Header Props
 */
export interface MockHeaderProps {
  title: string
}
