import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const uploadRoutes: MockRoute[] = [
  {
    method: 'POST', path: '/api/upload',
    handler: () => ok({ file_id: Date.now(), url: '/mock-uploaded-file.pdf' }),
  },
]

export const fileBodyRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/file-bodies',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/file-bodies/{file_id}',
    handler: () => ok({ file_id: 1, content: 'Mock file content', version: 1 }),
  },
  {
    method: 'GET', path: '/api/file-bodies/{file_id}/chunking-status',
    handler: () => ok({ status: 'completed' }),
  },
  {
    method: 'GET', path: '/api/file-bodies/{file_id}/chunks',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/file-bodies/{file_id}/chunks/{chunk_id}/split',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/file-bodies/{file_id}/chunks/merge',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/file-bodies/{file_id}/reconvert',
    handler: () => ok(null),
  },
]

export const platformSettingsRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/platform-settings',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/platform-settings/{id}',
    handler: () => ok({}),
  },
  {
    method: 'POST', path: '/api/platform-settings',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'PUT', path: '/api/platform-settings/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/platform-settings/{id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/platform-settings/{id}/toggle',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/platform-settings/wps/status',
    handler: () => ok({ enabled: false }),
  },
]

export const embeddingRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/embedding/models',
    handler: () => ok([
      { name: 'text-embedding-ada-002', dimensions: 1536 },
      { name: 'text-embedding-3-small', dimensions: 1536 },
    ]),
  },
  {
    method: 'GET', path: '/api/embedding/models/default',
    handler: () => ok({ name: 'text-embedding-ada-002', dimensions: 1536 }),
  },
  {
    method: 'GET', path: '/api/embedding/models/groups',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/embedding/models/rerank',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/embedding/models/validate',
    handler: () => ok({ valid: true }),
  },
]

export const chunkSettingRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/chunk-settings',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/chunk-settings/default',
    handler: () => ok({ chunk_size: 500, chunk_overlap: 50 }),
  },
  {
    method: 'GET', path: '/api/chunk-settings/channels',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/chunk-settings/embedding-models',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/chunk-settings/document-extension-map',
    handler: () => ok({}),
  },
  {
    method: 'POST', path: '/api/chunk-settings/validate-channels',
    handler: () => ok({ valid: true }),
  },
  {
    method: 'POST', path: '/api/chunk-settings/validate-embedding-model',
    handler: () => ok({ valid: true }),
  },
]

export const shareRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/shares',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/shares',
    handler: () => ok({ share_id: 'share-' + Date.now() }),
  },
  {
    method: 'GET', path: '/api/shares/{share_id}',
    handler: () => ok({ share_id: 'mock' }),
  },
  {
    method: 'DELETE', path: '/api/shares/{share_id}',
    handler: () => ok(null),
  },
]

export const shortcutRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/shortcuts',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/shortcuts',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'PUT', path: '/api/shortcuts/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/shortcuts/{id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/shortcuts/by_related',
    handler: () => ok([]),
  },
]

export const favoriteRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/favorites',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/favorites/toggle',
    handler: () => ok(null),
  },
]

export const approvalRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/approvals',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/approvals/{id}/approve',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/approvals/{id}/reject',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/approvals/detail',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/approvals/latest-pending',
    handler: () => ok(null),
  },
]

export const subscriptionRoutes: MockRoute[] = [
  {
    method: 'POST', path: '/api/subscriptions/batch',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/subscriptions/settings',
    handler: () => ok([]),
  },
]

export const ragRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/rag/config',
    handler: () => ok({}),
  },
  {
    method: 'GET', path: '/api/rag/jobs',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/rag/stats',
    handler: () => ok({ total: 0, completed: 0, pending: 0, failed: 0 }),
  },
  {
    method: 'POST', path: '/api/rag/search',
    handler: () => ok({ results: [] }),
  },
  {
    method: 'GET', path: '/api/rag/v2/pipelines',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/rag/v2/strategies',
    handler: () => ok([]),
  },
]

export const apiKeyRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/api-keys',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/api-keys',
    handler: () => ok({ id: Date.now(), key: 'sk-mock-' + Date.now() }),
  },
  {
    method: 'DELETE', path: '/api/api-keys/{id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/api-keys/{id}/enable',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/api-keys/{id}/disable',
    handler: () => ok(null),
  },
]

export const systemRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/system/redis-stats',
    handler: () => ok({ connected_clients: 1, used_memory: '1MB' }),
  },
  {
    method: 'GET', path: '/api/system_logs',
    handler: () => ok({ logs: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/system_logs/modules',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/system_logs/actions',
    handler: () => ok([]),
  },
]

export const messageRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/messages/list',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/messages/{id}',
    handler: () => ok({}),
  },
  {
    method: 'GET', path: '/api/messages/{id}/files',
    handler: () => ok([]),
  },
]

export const orderRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/orders',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/orders/me',
    handler: () => ok(null),
  },
]

export const searchRoutes: MockRoute[] = [
  {
    method: 'POST', path: '/api/external-knowledge/retrieval',
    handler: () => ok({ results: [] }),
  },
]

export const entityRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/entities',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/entities',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'GET', path: '/api/entities/{id}',
    handler: () => ok({}),
  },
  {
    method: 'PUT', path: '/api/entities/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/entities/{id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/entities/types',
    handler: () => ok([]),
  },
]
