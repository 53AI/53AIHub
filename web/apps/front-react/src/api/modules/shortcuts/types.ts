export type ShortcutType = "agent" | "library" | "ai_link" | "wiki_page";

export interface ShortcutRelatedInfo {
  /** wiki_page: 所属空间 ID，用于还原访问路径 */
  space_id?: string;
  /** wiki_page: 页面 slug（用于 URL ?selected=） */
  slug?: string;
  /** file: 所属 library_id */
  library_id?: string;
}

export interface ShortcutItem {
  id: string;
  related_id: string;
  raw_related_id: number;
  type: ShortcutType;
  logo?: string;
  name?: string;
  created_time?: number;
  updated_time?: number;
  url?: string;
  related_info?: ShortcutRelatedInfo;
}

export interface ShortcutCreateRequest {
  related_id: string;
  type: ShortcutType;
  related_info?: ShortcutRelatedInfo;
}

export interface ShortcutListResponse {
  shortcuts: ShortcutItem[];
}

export interface ShortcutGetByRelatedParams {
  type: ShortcutType;
  related_id: string;
}
