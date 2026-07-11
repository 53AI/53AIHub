import request from '../index'
import { type ChunkType, type EmbeddingStatus, type ChunkingStatus, type ReindexType, type AIGenerateChunkStatus } from '@/constants/chunk'

export interface KnowledgeChunk {
  id: number
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
  is_manual_edited: boolean
  embedding_status: EmbeddingStatus
  vector_id: string
  created_time: number
  updated_time: number
  ai_generate_doc_chunk_status: AIGenerateChunkStatus
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
    retrieval_chunks?: {
      index: number
      content: string
      token_count: number
      knowledge_chunk_index: number
      type: string
    }[]
  }[]
}

interface ChunkSettingConfig {
  chunking_config: {
    knowledge_chunking: {
      split_rule: string
      max_length: number
      overlap_size: number
    }
    index_chunking: {
      split_rule: string
      max_length: number
      overlap_size: number
    }
  }
}

const chunksApi = {
  get(id: KnowledgeChunk['id']) {
    return request.get(`/api/chunks/${id}`).then((res) => res.data)
  },

  update(id: KnowledgeChunk['id'], data: { content: KnowledgeChunk['content'] }) {
    return request.put(`/api/chunks/${id}`, data).then((res) => res.data)
  },

  delete(id: KnowledgeChunk['id']) {
    return request.delete(`/api/chunks/${id}`).then((res) => res.data)
  },

  sync(data: { file_id: KnowledgeChunk['file_id'] }) {
    return request.post('/api/chunks/sync', data).then((res) => res.data)
  },

  preview(data: {
    file_id: KnowledgeChunk['file_id']
    chunking_config?: ChunkSettingConfig['chunking_config']
    config_id?: string
  }): Promise<ChunkPreviewData> {
    return request.post('/api/chunks/preview', data).then((res) => res.data)
  },

  reindex(data: { file_id: KnowledgeChunk['file_id']; mode: ReindexType }) {
    return request.post('/api/chunks/reindex', data)
  },

  files: {
    list(file_id: KnowledgeChunk['file_id'], params: { status?: '' | 'enabled' | 'disabled'; keyword?: string } = {}) {
      return request.get(`/api/chunks/files/${file_id}`, { params }).then((res) => res.data)
    },

    create(file_id: KnowledgeChunk['file_id'], data: ChunkFileCreateData) {
      return request.post(`/api/chunks/files/${file_id}`, data).then((res) => res.data)
    },

    batch(file_id: KnowledgeChunk['file_id'], data: ChunkOperationsData) {
      return request.post(`/api/chunks/files/${file_id}/batch`, data).then((res) => res.data)
    }
  },

  status(data: { file_id: KnowledgeChunk['file_id'] }): Promise<KnowledgeChunkStatusData> {
    return request.post('/api/chunks/status', data).then((res) => res.data)
  },

  disable(chunk_id: KnowledgeChunk['id']): Promise<boolean> {
    return request.post(`/api/chunks/${chunk_id}/disable`).then((res) => res.data)
  },

  enable(chunk_id: KnowledgeChunk['id']): Promise<boolean> {
    return request.post(`/api/chunks/${chunk_id}/enable`).then((res) => res.data)
  },

  knowledge: {
    save(data: KnowledgeChunkRequestData) {
      return request.post('/api/chunks/knowledge', data).then((res) => res.data)
    },

    delete(chunk_id: KnowledgeChunk['id']) {
      return request.delete(`/api/chunks/knowledge/${chunk_id}`).then((res) => res.data)
    }
  },

  retrieval: {
    get(chunk_id: KnowledgeChunk['id']): Promise<{
      knowledge_chunk: KnowledgeChunk
      retrieval_chunks: RetrievalChunk[]
      stats: RetrievalStas
      total_count: number
    }> {
      return request.get(`/api/chunks/knowledge/${chunk_id}/retrieval`).then((res) => res.data)
    },

    create(chunk_id: KnowledgeChunk['id'], data: { content: KnowledgeChunk['content'] }) {
      return request.post(`/api/chunks/knowledge/${chunk_id}/retrieval`, data).then((res) => res.data)
    }
  },

  batchGet(data: { chunk_ids: string[]}): Promise<KnowledgeChunk[]> {
    return request
      .post(`/api/chunks/batch-get`, data)
      .then((res) => res.data)
      .catch((err) => {
        console.error(err)
        return []
      })
  }
}

export default chunksApi
