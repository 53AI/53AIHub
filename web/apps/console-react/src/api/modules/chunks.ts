import service from '../config'
import { handleError } from '../error-handler'

import type { ChunkType, EmbeddingStatus, ChunkingStatus } from '@/constants/chunk'

export interface KnowledgeChunk {
  id: string
  eid: number
  file_id: string
  library_id: string
  content: string
  content_hash: string
  chunk_index: number
  chunk_type: string
  start_position: number
  end_position: number
  token_count: number
  status: string
  is_manual_edited: false
  embedding_status: EmbeddingStatus
  vector_id: ''
  created_time: number
  updated_time: number
}

export interface RetrievalChunk {
  id: number
  eid: number
  file_id: string
  library_id: string
  knowledge_chunk_id: number
  content: string
  content_hash: string
  chunk_index: number
  chunk_type: ChunkType
  start_position: number
  end_position: number
  token_count: number
  status: string
  is_manual_edited: boolean
  embedding_status: EmbeddingStatus
  vector_id: string
  search_keywords: string
  search_weight: number
  created_time: number
  updated_time: number
}

export interface RetrievalStas {
  total_tokens: number
  avg_tokens: number
  embedded_count: number
  pending_count: number
}

export interface ChunkFileCreateData {
  config_id: number
  force: boolean
}

export interface KnowledgeChunkStatusData {
  can_edit: boolean
  chunking_status: ChunkingStatus
  is_locked: boolean
  message: string
}

export interface KnowledgeChunkRequestData {
  common_questions: string[]
  summary: string[]
  config_id?: number
  content: KnowledgeChunk['content']
  related_knowledge_ids: KnowledgeChunk['id'][]
  chunk_id?: KnowledgeChunk['id']
  file_id: KnowledgeChunk['file_id']
  library_id: KnowledgeChunk['library_id']
}

export interface ChunkOperation {
  action: 'split' | 'merge'
  identifier: string
  content: string
  origin_identifier?: string
  merge_identifiers?: string[]
}

export interface ChunkOperationsData {
  update_retrieval_chunk?: boolean
  content_updates: Record<string, { content: string }>
  operations: ChunkOperation[]
}

export interface ChunkPreviewData {
  chunks: {
    index: number
    type: string
    question?: string
    content: string
    token_count: number
    start_pos: number
    end_pos: number
    child_chunks?: {
      index: number
      content: string
      token_count: number
      start_pos: number
      end_pos: number
    }[]
  }[]
}

const chunksApi = {
  get(id: KnowledgeChunk['id']) {
    return service
      .get(`/api/chunks/${id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  files: {
    list(
      file_id: KnowledgeChunk['file_id'],
      params: { status?: '' | 'enabled' | 'disabled'; keyword?: string } = {},
    ) {
      return service
        .get(`/api/chunks/files/${file_id}`, { params })
        .then((res: any) => res.data)
        .catch(handleError)
    },
  },
}

export default chunksApi

