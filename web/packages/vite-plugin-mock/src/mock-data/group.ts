import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockGroups = [
  {
    id: 1,
    name: 'Default Group',
    type: 'agent',
    description: 'Default agent group',
    eid: 1,
    sort: 0,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
  {
    id: 2,
    name: 'Prompt Templates',
    type: 'prompt',
    description: 'Collection of prompt templates',
    eid: 1,
    sort: 1,
    created_time: now - 86400 * 14,
    updated_time: now,
  },
]

export const groupRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/groups',
    handler: () => ok(mockGroups),
  },
  {
    method: 'POST', path: '/api/groups',
    handler: (_req, _params, body) => ok({ id: Date.now(), eid: 1, sort: 0, created_time: now, updated_time: now, ...body }),
  },
  {
    method: 'GET', path: '/api/groups/{id}',
    handler: (_req, params) => {
      const gid = parseInt(params.id)
      const group = mockGroups.find(g => g.id === gid) || mockGroups[0]
      return ok(group)
    },
  },
  {
    method: 'PUT', path: '/api/groups/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/groups/{id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/groups/{id}/agents',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/groups/{id}/agents',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/groups/{id}/agents',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/groups/{id}/resources',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/groups/{id}/resources',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/groups/{id}/resources',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/groups/{id}/users',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/groups/{id}/users/batch',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/groups/{id}/users',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/groups/type/{group_type}',
    handler: (_req, params) => {
      const type = params.group_type
      return ok(mockGroups.filter(g => g.type === type))
    },
  },
  {
    method: 'GET', path: '/api/groups/type/current/{group_type}',
    handler: (_req, params) => {
      const type = params.group_type
      return ok(mockGroups.filter(g => g.type === type))
    },
  },
  {
    method: 'GET', path: '/api/groups/prompt',
    handler: () => ok(mockGroups.filter(g => g.type === 'prompt')),
  },
]
