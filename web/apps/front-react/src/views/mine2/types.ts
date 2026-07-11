/**
 * 基础文件项类型 - 所有子视图共享
 */
export interface MineFileItem {
  id: string
  name: string
  icon: string
  path: string
  isfolder: boolean
  createdTime: string
  updatedTime: string
  isFavorite: boolean
  rawData: unknown
}

/**
 * 扩展文件项类型 - 包含文件扩展名和URL
 */
export interface FileItem extends MineFileItem {
  file_ext?: string
  file_url?: string
}

/**
 * 面包屑项
 */
export interface BreadcrumbItem {
  name: string
  path: string
}

/**
 * 文件列表请求参数
 */
export interface FetchParams {
  path: string
  keyword?: string
  offset: number
  limit: number
  type?: 'file' | 'dir'
}

/**
 * 录音配置（用于控制轮询行为）
 */
export interface RecordingConfigForPreview {
  enabled: boolean
  parser_platform: string
}

/**
 * 预览文件信息
 */
export interface PreviewFile {
  id: string
  name: string
  icon?: string
  file_url?: string
  file_ext?: string
  file_mime?: string
  library_id?: string
  content?: string
  updated_time?: string
  isFavorite?: boolean
  isfolder?: boolean
  rawData?: unknown
  /** 录音配置，仅在录音tab中使用 */
  recordingConfig?: RecordingConfigForPreview
}

/**
 * 筛选类型 - 收藏和最近访问共用
 */
export type FilterType = 'all' | 'library' | 'file'

/**
 * Tab 键类型
 */
export type MineTabKey = 'fav' | 'visit' | 'ai' | 'upload' | 'audio'
