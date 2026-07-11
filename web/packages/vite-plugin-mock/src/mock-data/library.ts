import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockLibraries = [
  {
    id: 1,
    name: 'Product Documentation',
    description: 'Official product documentation and guides',
    icon: '',
    uuid: 'lib-uuid-001',
    eid: 1,
    creator_id: 1,
    space_id: 1,
    status: 0,
    visibility: 1,
    permission: 10000,
    is_favorite: false,
    sort: 0,
    created_time: now - 86400 * 14,
    updated_time: now - 3600,
    recent: [],
  },
  {
    id: 2,
    name: 'Technical Knowledge Base',
    description: 'Technical articles and solutions',
    icon: '',
    uuid: 'lib-uuid-002',
    eid: 1,
    creator_id: 1,
    space_id: 1,
    status: 0,
    visibility: 1,
    permission: 10000,
    is_favorite: true,
    sort: 1,
    created_time: now - 86400 * 7,
    updated_time: now - 1800,
    recent: [],
  },
  {
    id: 3,
    name: 'FAQ Collection',
    description: 'Frequently asked questions and answers',
    icon: '',
    uuid: 'lib-uuid-003',
    eid: 1,
    creator_id: 1,
    space_id: 2,
    status: 0,
    visibility: 0,
    permission: 1,
    is_favorite: false,
    sort: 2,
    created_time: now - 86400 * 3,
    updated_time: now - 7200,
    recent: [],
  },
]

export const libraryRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/libraries',
    handler: () => ok(mockLibraries),
  },
  {
    method: 'GET', path: '/api/libraries/recently',
    handler: () => ok(mockLibraries.slice(0, 2)),
  },
  {
    method: 'GET', path: '/api/libraries/search',
    handler: () => ok(mockLibraries),
  },
  {
    method: 'POST', path: '/api/libraries',
    handler: (_req, _params, body) => ok({
      id: Date.now(),
      uuid: 'lib-uuid-new',
      eid: 1,
      creator_id: 1,
      space_id: 1,
      status: 0,
      visibility: 1,
      permission: 10000,
      is_favorite: false,
      sort: mockLibraries.length,
      created_time: now,
      updated_time: now,
      recent: [],
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/libraries/{library_id}',
    handler: (_req, params) => {
      const lid = parseInt(params.library_id)
      const lib = mockLibraries.find(l => l.id === lid) || mockLibraries[0]
      return ok(lib)
    },
  },
  {
    method: 'PUT', path: '/api/libraries/{library_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/libraries/{library_id}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/libraries/sort',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/libraries/{library_id}/search',
    handler: () => ok({ results: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/libraries/{library_id}/queries',
    handler: () => ok({ queries: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/libraries/{library_id}/api-keys',
    handler: () => ok({ api_keys: [], count: 0 }),
  },
  {
    method: 'POST', path: '/api/libraries/{library_id}/api-keys',
    handler: () => ok({ id: 1, key: 'mock-key-' + Date.now() }),
  },
  {
    method: 'DELETE', path: '/api/libraries/{library_id}/api-keys/{key_id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/libraries/{library_id}/api-keys/{key_id}/enable',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/libraries/{library_id}/api-keys/{key_id}/disable',
    handler: () => ok(null),
  },
]
