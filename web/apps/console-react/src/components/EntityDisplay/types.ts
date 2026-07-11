export type { EntityType, EntityInfo, UserInfo, GroupInfo, EntityDisplayConfig } from '@/types/entity'

/**
 * EntityDisplay component instance type
 */
export interface EntityDisplayInstance {
  entityInfo: EntityInfo | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Component event types
 */
export interface EntityDisplayEmits {
  /** Entity info loaded */
  onLoaded?: (info: EntityInfo | null) => void
  /** Entity info load error */
  onError?: (error: Error) => void
  /** Entity clicked */
  onClick?: (info: EntityInfo | null) => void
}