import request from '../../index'
import { handleError } from '../../errorHandler'

export type LibraryItem = {
  id: string
  name: string
  icon: string
  description: string
  visibility?: number
  created_time: number
  updated_time: number
  is_favorite: boolean
  space_id: string
  permission: number
  recent: {
    id: number
    name: string
    icon: string
    description: string
  }[]
}

export type LibraryListResponse = LibraryItem[]

export type LibraryListRequest = {
  space_id: string
  status?: number
  limit?: number
  keyword?: string
  get_recently?: number
  with_file_count?: number
}

export type LibraryCreateRequest = {
  space_id: string
  name: string
  icon: string
  description: string
  permissions: {
    subject_type: number
    subject_id: number
    permission: number
  }[]
}

export type LibraryUpdateRequest = {
  space_id: string
  name: string
  icon: string
  description: string
}

export type HistoryListRequest = {
  page?: number
  page_size?: number
  search_type?: string
  start_date?: string
  end_date?: string
}

export type SearchConfig = {
  query: string
  search_config?: {
    fulltext?: boolean
    hybrid?: boolean
    rerank_channel_id?: number
    rerank_model?: string
    rerank_model_name?: string
    reranking_enable?: boolean
    score_threshold?: number
    score_threshold_enabled?: boolean
    top_k?: number
    vector?: boolean
    weights?: {
      keyword_setting: {
        keyword_weight: number
      }
      vector_setting: {
        vector_weight: number
      }
    }
  }
}

export interface FileStats {
  conversion_normal_count: number
  parsing_normal_count: number
  total_character_count: number
  total_files: number
}

export interface DocumentStats {
  status_stats: {
    disabled: number
    enabled: number
  }
  total_chunks: number
  total_recalls: number
  total_tokens: number
}

export interface ChunkStats {
  default_count: number
  enhanced_count: number
  question_count: number
  summary_count: number
  total_chunks: number
}

export const librariesApi = {
  list(params: LibraryListRequest): Promise<LibraryListResponse> {
    return request.get('/api/libraries', { params }).then((res) => res.data)
      .catch(err => handleError(err, {functionName:  window.$t('library.name')}))
  },

  search(params: { name: string }): Promise<LibraryListResponse> {
    return request.get('/api/libraries/search', { params }).then((res) => res.data).catch(handleError)
  },

  create(data: LibraryCreateRequest) {
    return request.post('/api/libraries', data).catch(err => handleError(err, {functionName:  window.$t('library.name')}))
  },

  update(library_id: string, data: LibraryUpdateRequest) {
    return request.put(`/api/libraries/${library_id}`, data).catch(handleError)
  },

  document_stats(library_id: string): Promise<DocumentStats> {
    return request.get(`/api/document-chunks/libraries/${library_id}/stats`).then((res) => res.data).catch(handleError)
  },

  chunk_stats(library_id: string): Promise<ChunkStats> {
    return request.get(`/api/retrieval-chunks/libraries/${library_id}/stats`).then((res) => res.data).catch(handleError)
  },

  file_stats(library_id: string): Promise<FileStats> {
    return request.get(`/api/files/libraries/${library_id}/stats`).then((res) => res.data).catch(handleError)
  },

  delete(library_id: string) {
    return request.delete(`/api/libraries/${library_id}`).catch(handleError)
  },

  get(library_id: string): Promise<LibraryItem> {
    return request.get(`/api/libraries/${library_id}`).then((res) => res.data).catch(handleError)
  },

  recently(): Promise<LibraryItem[]> {
    return request.get(`/api/libraries/recently`).then((res) => res.data).catch(handleError)
  },

  searchHistory(library_id: string, params: HistoryListRequest) {
    return request.get(`/api/libraries/${library_id}/queries`, { params }).then((res) => res.data).catch(handleError)
  },

  searchResult(library_id: string, data: SearchConfig) {
    return request.post(`/api/libraries/${library_id}/search`, data).then((res) => res.data).catch(handleError)
  }
}

export default librariesApi
