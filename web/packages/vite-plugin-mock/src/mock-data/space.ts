import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockSpaces = [
  {
    id: 1,
    name: 'Default Space',
    description: 'The default workspace',
    icon: '',
    eid: 1,
    owner_id: 1,
    is_default: true,
    status: 0,
    visibility: 1,
    library_count: 2,
    permission: 10000,
    sort: 0,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
  {
    id: 2,
    name: 'Team Space',
    description: 'Shared team workspace',
    icon: '',
    eid: 1,
    owner_id: 1,
    is_default: false,
    status: 0,
    visibility: 0,
    library_count: 1,
    permission: 10000,
    sort: 1,
    created_time: now - 86400 * 14,
    updated_time: now - 3600,
  },
]

export const spaceRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/spaces',
    handler: () => ok({ spaces: mockSpaces, count: mockSpaces.length }),
  },
  {
    method: 'POST', path: '/api/spaces',
    handler: (_req, _params, body) => ok({
      id: Date.now(),
      eid: 1,
      owner_id: 1,
      is_default: false,
      status: 0,
      library_count: 0,
      permission: 10000,
      sort: mockSpaces.length,
      created_time: now,
      updated_time: now,
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/spaces/{space_id}',
    handler: (_req, params) => {
      const sid = parseInt(params.space_id)
      const space = mockSpaces.find(s => s.id === sid) || mockSpaces[0]
      return ok(space)
    },
  },
  {
    method: 'PUT', path: '/api/spaces/{space_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/spaces/{space_id}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/spaces/sort',
    handler: () => ok(null),
  },
]
