export interface SortableHandleProps {
  attributes: Record<string, unknown>
  listeners: Record<string, unknown>
  setActivatorNodeRef: (node: HTMLElement | null) => void
  dragHandleClassName: string
}

export type SortableItemId = string | number

export interface SortableItem<T = unknown> {
  id: SortableItemId
  data: T
}

export interface SortableGroup<T = unknown> {
  id: number | string
  title?: string
  items: SortableItem<T>[]
}

