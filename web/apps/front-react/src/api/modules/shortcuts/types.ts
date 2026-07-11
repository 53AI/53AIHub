export type ShortcutType = 'agent' | 'library' | 'ai_link'

export interface ShortcutItem {
  id: string
  related_id: string
  raw_related_id: number
  type: ShortcutType
  logo?: string
  name?: string
  created_time?: number
  updated_time?: number
  url?: string
}

export interface ShortcutCreateRequest {
  related_id: string
  type: ShortcutType
}

export interface ShortcutListResponse {
  shortcuts: ShortcutItem[]
}

export interface ShortcutGetByRelatedParams {
  type: ShortcutType
  related_id: string
}
