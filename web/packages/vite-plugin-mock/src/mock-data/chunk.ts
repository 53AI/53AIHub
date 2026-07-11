import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockChunks = [
  {
    id: 1,
    file_id: 1,
    content: 'This is the first chunk of the document. It contains introductory information about the platform and its capabilities.',
    type: 'knowledge',
    embedding_status: 'normal',
    start_pos: 0,
    end_pos: 500,
    token_count: 150,
    vector_id: 'vec_001',
    is_manual_edited: false,
    created_time: now - 86400 * 7,
    updated_time: now - 3600,
  },
  {
    id: 2,
    file_id: 1,
    content: 'The API provides a comprehensive set of endpoints for managing resources. Authentication is handled via Bearer tokens.',
    type: 'knowledge',
    embedding_status: 'normal',
    start_pos: 500,
    end_pos: 1000,
    token_count: 180,
    vector_id: 'vec_002',
    is_manual_edited: false,
    created_time: now - 86400 * 7,
    updated_time: now - 3600,
  },
  {
    id: 3,
    file_id: 1,
    content: 'For error handling, all API responses follow a standard format with code, message, and data fields.',
    type: 'knowledge',
    embedding_status: 'normal',
    start_pos: 1000,
    end_pos: 1500,
    token_count: 120,
    vector_id: 'vec_003',
    is_manual_edited: true,
    created_time: now - 86400 * 7,
    updated_time: now - 1800,
  },
]

const mockChunkStats = {
  total_chunks: 10,
  knowledge_chunks: 8,
  embedded_chunks: 6,
  index_chunks: 2,
  manual_edited_chunks: 2,
  total_tokens: 3000,
  average_tokens: 300,
}

export const chunkRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/chunks/files/{file_id}',
    handler: () => ok({ chunks: mockChunks, stats: mockChunkStats }),
  },
  {
    method: 'GET', path: '/api/chunks/{id}',
    handler: (_req, params) => {
      const cid = parseInt(params.id)
      const chunk = mockChunks.find(c => c.id === cid) || mockChunks[0]
      return ok(chunk)
    },
  },
  {
    method: 'PUT', path: '/api/chunks/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/chunks/{id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/chunks/{id}/enable',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/chunks/{id}/disable',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/{id}/split',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/batch',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/batch/enable',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/batch/disable',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/merge',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/reindex',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/sync',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/chunks/status',
    handler: () => ok({ status: 'idle' }),
  },
  {
    method: 'GET', path: '/api/chunks/edit-status/{file_id}',
    handler: () => ok({ editing: false }),
  },
  {
    method: 'GET', path: '/api/chunks/relations/stats/{file_id}',
    handler: () => ok({ related_chunks: 0 }),
  },
  {
    method: 'POST', path: '/api/chunks/preview',
    handler: () => ok({ chunks: mockChunks }),
  },
  {
    method: 'POST', path: '/api/chunks/restore',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/knowledge',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/knowledge/{knowledge_id}/retrieval',
    handler: () => ok({ results: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/chunks/retrieval/{retrieval_id}',
    handler: () => ok({ chunks: mockChunks, stats: mockChunkStats }),
  },
  {
    method: 'POST', path: '/api/chunks/retrieval/{retrieval_id}/split',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/chunks/retrieval/merge',
    handler: () => ok(null),
  },
]
