import { AIGenerateChunkStatus } from '@/constants/chunk'
import { PermissionType } from '@/components/KMPermission/constant'

export type TreeBuildNode = {
  path: string
  base_path: string
  isfolder: boolean
  sort: number
  children?: any[]
}

export type TreeNode<T> = T & { children: TreeNode<T>[] }

export interface RawFileItem {
  id: string
  sort: number
  path: string
  type: number
  library_id: string
  eid: number
  created_time: number
  updated_time: number
  upload_file_id: number
  parsing_status: string
  parse_type: string
  last_body_time: number
  ai_generate_chunk_status: AIGenerateChunkStatus
  questions: string
  summary: string
  knowledge_map: string
  upload_source: string
  cleaning_rule_info: string
  insight_summary: string
  origin_source?: string
  upload_file: {
    id: number
    file_name: string
    key: string
    eid: number
    user_id: number
    size: number
    extension: string
    mime_type: string
    hash: string
    preview_key: string
    status: string
    error: string
    processed_time: number
    created_time: number
    updated_time: number
  } | null
}

export interface FileItem extends RawFileItem {
  is_favorite: boolean
  name: string
  isfolder: boolean
  isfile: boolean
  base_path: string
  file_type: string
  file_size: string
  file_ext: string
  file_mime: string
  file_url: string
  parsing_status: string
  cleaning_info: {
    step_key: string
    strategy_id: string
    strategy_name: string
    strategy_icon: string
    pipeline_id: string
    pipeline_name: string
    pipeline_icon: string
    run_id: string
    status: string
    progress: number
    success_count: number
    failure_count: number
    total_steps: number
  } | null
  created_at: string
  icon: string
  updated_at: string
  updated_date: string
  last_body_time: number
  parse_type: string
  permission: PermissionType
  children?: FileItem[]
}

export interface CheckedFileItem extends Omit<FileItem, 'children'> {
  checked: boolean
  isEditing: boolean
  children?: CheckedFileItem[]
}

export type FileListParams = {
  path: string
  library_id: string
}

export type FileLockParams = {
  action: 'add' | 'delete'
}

export type FileLockResponse = {
  file_id: string
  success: boolean
  message: string
}

// 批量上传相关类型定义
export type FileStructureItem = {
  relative_path: string
  size: number
  is_directory: boolean
  parent_path: string
  depth: number
}

export type DuplicateFile = {
  existing_id: number
  relative_path: string
}

export type BatchUploadInitParams = {
  library_id: string
  base_path?: string
  total_files: number
  total_size: number
  file_structure: FileStructureItem[]
}

export type BatchUploadInitResponse = {
  batch_id: string
  upload_token: string
  max_concurrent: number
  chunk_size: number
  ws_endpoint: string
  file_mappings: Record<string, string>
  duplicate_files: DuplicateFile[]
}

export type BatchUploadFileParams = {
  file: File
  upload_token: string
  file_upload_id: string
  duplicate_mode?: 'sequence' | 'replace'
}

export type BatchUploadFileResponse = {
  file_id: string
  status: 'queued' | 'uploading' | 'uploaded' | 'converting' | 'completed' | 'failed'
}

export type FileSearchParams = {
  query?: string
  top_k?: number
  library_ids?: string[]
  case_sensitive?: boolean
  fuzzy_threshold?: number
}

export type FileSearchResponse = {
  query: string
  results: {
    creator_id: number
    creator_name: string
    file_id: number
    highlight: string
    library_id: number
    library_name: string
    path: string
    score: number
    space_id: number
    space_name: string
    type: number
    latest_file_body_update_time: number
  }[]
  total: number
}

export type BatchUploadProgressResponse = {
  batch_id: string
  status: 'init' | 'uploading' | 'converting' | 'completed' | 'failed' | 'cancelled'
  batch_progress: {
    total_files: number
    uploaded_files: number
    failed_files: number
    total_size: number
    uploaded_size: number
    overall_progress: number
    status: string
    start_time: number
    estimated_eta: number
  }
  files: Record<
    string,
    {
      error: string
      file_id: string
      file_upload_id: string
      relative_path: string
      status: string
      progress: number
      uploaded_size: number
      total_size: number
      speed: number
      eta: number
    }
  >
  last_update: number
}

export type RecycleListParams = {
  library_id?: RawFileItem['library_id']
  offset?: number
  limit?: number
  sort?: 'asc' | 'desc'
  q?: string
}

export interface RawRecycleListItem extends RawFileItem {
  deleted_at: number
  deleted_by: number
  is_active_deleted: boolean
  is_deleted: boolean
}

export interface RecycleListItem extends FileItem {
  deleted_time: string
  remaining_days: number
}

export type RecycleListResponse = {
  items: RawRecycleListItem[]
  count: number
}

export type RawRecycleList = {
  items: RawRecycleListItem[]
}

export type ParentExistsResponse = {
  exists: boolean
  parent_id: number
  parent_path: string
}
