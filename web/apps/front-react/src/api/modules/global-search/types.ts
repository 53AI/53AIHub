// ==================== 基础类型 ====================

/** 知识空间简化信息 */
export interface GlobalSearchSpace {
  id: string;
  name: string;
  icon: string;
  creator_id?: number;
  creator_name?: string;
  created_time?: number;
  updated_time?: number;
}

/** 知识库简化信息 */
export interface GlobalSearchLibrary {
  id: string;
  name: string;
  space_id: string;
  icon: string;
  creator_id?: number;
  creator_name?: string;
  created_time?: number;
  updated_time?: number;
}

// ==================== Quick Tags ====================

/** Quick Tags 响应 */
export interface QuickTagsResponse {
  spaces: GlobalSearchSpace[];
  libraries: GlobalSearchLibrary[];
}

/** Quick Tags 请求参数 */
export interface QuickTagsParams {
  mode?: 'recent_access' | 'recent_update';
}

// ==================== Search ====================

/** 搜索结果项 */
export interface GlobalSearchResultItem {
  file_id: string;
  file_name: string;
  /** 后端生成的高亮正文片段 HTML（含 <mark> 高亮 + [[entity/x|label]] 语法） */
  content_highlight?: string;
  path: string;
  library_id: string;
  library_name: string;
  space_id: string;
  space_name: string;
  creator_id: number;
  creator_name: string;
  highlight?: string;
  latest_file_body_update_time: number;
  icon?: string;
  type?: number;
  isfolder?: boolean;
}

/** 搜索结果分页体（按数据源区分字段） */
interface SearchResultPage<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

/** 搜索响应：普通文档走 rag_results，wiki 源走 wiki_results */
export interface GlobalSearchResponse {
  rag_results?: SearchResultPage<GlobalSearchResultItem>;
}/** 搜索请求参数 */
export interface GlobalSearchParams {
  query?: string;
  space_ids?: string[];
  library_ids?: string[];
  creator_ids?: number[];
  is_created_by_me?: boolean;
  file_types?: string[];
  created_time_from?: number;
  created_time_to?: number;
  updated_time_from?: number;
  updated_time_to?: number;
  sort_by?: 'recent_update' | 'recent_access';
  page?: number;
  size?: number;
}

/** 时间范围选项（用于前端筛选） */
export type TimeRangeValue = 'all' | '7d' | '30d' | '180d' | '365d';

/** 文档类型选项（用于前端筛选） */
export type DocTypeValue = 'all' | 'pdf' | 'txt' | 'markdown' | 'word' | 'excel' | 'powerpoint' | 'webpage' | 'audio' | 'epub';

// ==================== Spaces ====================

/** 空间搜索参数 */
export interface SpaceSearchParams {
  keyword?: string;
  creator_ids?: number[];
  created_time_from?: number;
  updated_time_from?: number;
}

// ==================== Libraries ====================

/** 知识库搜索参数 */
export interface LibrarySearchParams {
  keyword?: string;
  space_id?: string;
  creator_ids?: number[];
  space_ids?: string[];
  created_time_from?: number;
  updated_time_from?: number;
}

// ==================== 动态知识搜索（wiki 源） ====================

/** 动态知识搜索请求参数：在通用搜索参数基础上新增数据源 */
export interface DynamicSearchParams extends GlobalSearchParams {
  /** 数据源，当前仅 wiki */
  sources: string[];
}

/** 动态知识搜索结果项（wiki 页结构，非 RAG 文档结构） */
export interface WikiSearchResultItem {
  page_id: string;
  slug: string;
  title: string;
  summary: string;
  /** 后端生成的高亮正文片段 HTML（含 <mark> 高亮 + [[entity/x|label]] wiki 语法） */
  content_highlight?: string;
  body?: string;
  page_type: string;
  library_id: string;
  library_name: string;
  library_icon?: string;
  space_id: string;
  space_name: string;
  created_time: number;
  updated_time: number;
  score?: number;
  /** 后端生成的高亮 HTML（含 <mark> 标签） */
  highlight?: string;
  /** wiki 页所属分类（接口不一定返回） */
  categories?: Array<{
    id: string;
    name: string;
    slug: string;
    space_id: string;
  }>;
}

/** 动态知识搜索响应：wiki 源返回在 wiki_results */
export interface DynamicSearchResponse {
  wiki_results?: SearchResultPage<WikiSearchResultItem>;
}