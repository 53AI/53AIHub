/**
 * Wiki 知识库接口类型定义
 *
 * 路由前缀：`/api/spaces/{space_id}/wiki/...`
 *
 * 文档参考：`api.txt`
 */

/** 库类型：普通知识库 vs wiki 库 */
export type WikiLibraryKind = 'regular' | 'wiki'

/** wiki 库概要信息（嵌入在多个响应中） */
export interface WikiLibrary {
  id: string
  library_kind: WikiLibraryKind
  name: string
  permission: number
}

/** 页面状态 */
export type WikiPageStatus = 'active' | 'inactive'

/** 页面可见性：已知值；后端新增类型时需在此补充 */
export type WikiPageVisibility = 'workspace' | 'private' | 'public' | 'unknown'

/** 页面类型 */
export type WikiPageType = 'concept' | 'entity' | 'index' | 'summary'

/** 页面正文格式 */
export type WikiBodyFormat = 'markdown' | 'html'

/** 页面元信息（列表项 + 详情共用） */
export interface WikiPageItem {
  id: string
  eid: string
  slug: string
  title: string
  summary: string
  aliases?: string[]
  page_type: WikiPageType
  folder_id: number
  folder_path?: string
  library_id: string
  library_kind: WikiLibraryKind
  library_name: string
  space_id: string
  sort: number
  status: WikiPageStatus
  visibility: WikiPageVisibility
  creator_id: number
  updater_id: number
  current_version_id: number
  created_time: number
  updated_time: number
}

/** 版本发布渠道 */
export type WikiPublishKind = 'manual' | 'sync'

/** 页面版本（详情接口已与 WikiPageDetail 对齐） */
export interface WikiPageVersion {
  id: string
  page_id: number
  version_no: number
  version_tag: string
  eid: string
  slug: string
  title: string
  aliases?: string[]
  page_type: WikiPageType | string
  body?: string
  body_format: WikiBodyFormat
  change_summary: string
  checksum: string
  source_version: string
  is_published: boolean
  /** 是否为当前线上版本（同一页面最多一个版本 is_current=true） */
  is_current?: boolean
  publish_kind: WikiPublishKind | string
  published_time: number
  editor_id: number
  created_time: number
  updated_time: number
  /** 来源引用列表（详情接口返回，列表接口可能为空） */
  sources?: WikiPageSource[]
  /** 页面引出的 wiki 内链 */
  links?: WikiPageLink[]
  /** 反向链接：哪些页面链接到当前页面 */
  backlinks?: WikiPageLink[]
}

/** 页面反向链接 */
export interface WikiPageLink {
  id: string
  eid: string
  from_page_id: number
  from_page_title: string
  from_page_slug: string
  to_page_id: number
  link_kind: string
  anchor_text: string
  target_slug: string
  creator_id: number
  created_time: number
  updated_time: number
}

/** 页面来源引用 */
export interface WikiPageSource {
  id: string
  eid: string
  page_id: number
  source_kind: string
  source_slug: string
  source_url: string
  source_ref: string
  source_chunk_id: number
  source_content_hash: string
  source_location: string
  external_id: string
  external_digest: string
  meta_json: string
  /** 来源文件的 ID（用于跳转知识库文件详情） */
  source_file_id?: string
  /** 来源文件名称（用于展示） */
  file_name: string
  /** 来源文件所属知识库 ID（用于跳转知识库文件详情） */
  library_id: string
  creator_id: number
  last_synced_time: number
  created_time: number
  updated_time: number
}

/**
 * 页面详情完整响应
 *
 * 字段归属：
 * - `page` 承担元信息 + 正文的全部展示字段（含 body/sources/links/backlinks），
 *   渲染层统一通过 `detail.page.*` 读取。
 * - 顶层只保留与页面本身无关的"空间/库上下文"（libraries）和当前版本元数据
 *   `current_version`，避免字段重复导致读取歧义。
 */
export interface WikiPageDetail {
  /** 当前版本（含正文），作为权威版本信息挂在顶层 */
  current_version: WikiPageVersion
  /** 页面元信息 + 正文内容（统一读取入口） */
  page: WikiPageItem & {
    body: string
    body_format: WikiBodyFormat
    /** 来源引用列表 */
    sources: WikiPageSource[]
    /** 页面引出的 wiki 内链 */
    links: WikiPageLink[]
    /** 反向链接：哪些页面链接到当前页面 */
    backlinks?: WikiPageLink[]
  }
  /** 当前页面所属空间下挂的 wiki 库列表（用于跨库切换） */
  libraries: WikiLibrary[]
}

/** 页面类型统计（用于左侧标签列表） */
export interface WikiPageTypeCounts {
  concept: number
  entity: number
  index: number
  summary: number
  [key: string]: number
}

/** 索引页响应 */
export interface WikiIndexResponse {
  eid: string
  space_id: string
  total_pages: number
  index_markdown: string
  page_type_counts: WikiPageTypeCounts
  recent_index_pages: WikiPageItem[]
  recent_summary_pages: WikiPageItem[]
  libraries: WikiLibrary[]
}

/** 页面列表排序字段 */
export type WikiPageSortBy = 'updated_time' | 'created_time' | 'title'

/** 排序方向 */
export type WikiSortOrder = 'asc' | 'desc'

/** 页面列表查询参数 */
export interface WikiPageListParams {
  offset?: number
  limit?: number
  page_type?: WikiPageType
  keyword?: string
  sort_by?: WikiPageSortBy
  sort_order?: WikiSortOrder
}

/** 页面列表响应 */
export interface WikiPageListResponse {
  items: WikiPageItem[]
  total: number
  libraries: WikiLibrary[]
}

/**
 * 日志条目（新版）
 *
 * 字段来源：GET /api/spaces/{space_id}/wiki/logs
 */
export interface WikiLogItem {
  id: string
  action: string
  created_at: string
  doc_title: string
  knowledge_base_id: string
  knowledge_id: string
  pages_affected: Array<{ slug: string; title: string }>
  summary: string
}

/** meta_json 解析后的结构（部分字段） */
export interface WikiLogMeta {
  version_no?: number
  slug?: string
  [key: string]: unknown
}

/** 日志列表查询参数 */
export interface WikiLogListParams {
  offset?: number
  limit?: number
}

/** 日志列表响应 */
export interface WikiLogListResponse {
  entries: WikiLogItem[]
  total: number
}

/** 文件处理进度状态 */
export type WikiProgressStatus = 'not_started' | 'running' | 'success' | 'failed'

/** 文件处理进度项 */
export interface WikiProgressItem {
  run_id: string
  file_id: string
  file_name: string
  file_path: string
  library_id: string
  library_kind: WikiLibraryKind
  library_name: string
  status: WikiProgressStatus
  progress: number
  current_job_type: string
  step_key: string
  step_name: string
  next_step_key: string
  next_step_name: string
  start_time: number
  end_time: number
  duration_ms: number
  completion_time: number
  total_steps: number
  success_count: number
  failure_count: number
  token_usage: Record<string, unknown>
  updated_time: number
}

/** 空间文件处理进度响应 */
export interface WikiProgressResponse {
  items: WikiProgressItem[]
  libraries: WikiLibrary[]
  total: number
}

/** 更新页面请求参数 */
export interface WikiPageUpdateParams {
  page_type: WikiPageType
  title: string
  content: string
  change_summary?: string
}

/** 更新页面响应 */
export interface WikiPageUpdateResponse {
  page: WikiPageItem
  version: WikiPageVersion
}

/** 版本列表查询参数 */
export interface WikiVersionsListParams {
  offset?: number
  limit?: number
  /** 不传=全部，true=仅已发布，false=仅草稿 */
  is_published?: boolean
}

/** 版本列表响应 */
export interface WikiVersionsListResponse {
  items: WikiPageVersion[]
  total: number
}

/** 发布版本请求参数 */
export interface WikiVersionPublishParams {
  version_tag?: string
}

/** 发布版本响应 */
export interface WikiVersionPublishResponse {
  version: WikiPageVersion
}

/**
 * 空间 wiki 统计响应
 *
 * 路由：GET /api/spaces/{space_id}/wiki/stats
 * 用于动态知识面板展示摘要/实体/概念数量及本月新增、累计编译文档数
 */
export interface WikiStatsResponse {
  /** 摘要页数量 */
  wiki_summary_count: number
  /** 实体页数量 */
  wiki_entity_count: number
  /** 概念页数量 */
  wiki_concept_count: number
  /** 本月新增文档数 */
  month_new_docs: number
  /** 累计编译文档数 */
  total_docs: number
  /** 累计编译文档数 */
  wiki_compiled_docs: number
}