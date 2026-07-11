import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockNavigations = [
  {
    navigation_id: 1,
    name: 'Home',
    icon: 'home',
    type: 1,
    status: 1,
    jump_path: '/',
    config: '',
    content: { type: 'page', path: '/' },
    eid: 1,
    sort: 0,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
  {
    navigation_id: 2,
    name: 'Knowledge Base',
    icon: 'book',
    type: 1,
    status: 1,
    jump_path: '/libraries',
    config: '',
    content: { type: 'page', path: '/libraries' },
    eid: 1,
    sort: 1,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
  {
    navigation_id: 3,
    name: 'Agents',
    icon: 'robot',
    type: 1,
    status: 1,
    jump_path: '/agents',
    config: '',
    content: { type: 'page', path: '/agents' },
    eid: 1,
    sort: 2,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
]

export const navigationRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/navigations',
    handler: () => ok(mockNavigations),
  },
  {
    method: 'POST', path: '/api/navigations',
    handler: (_req, _params, body) => ok({
      navigation_id: Date.now(),
      eid: 1,
      sort: mockNavigations.length,
      created_time: now,
      updated_time: now,
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/navigations/{nav_id}',
    handler: (_req, params) => {
      const nid = parseInt(params.nav_id)
      const nav = mockNavigations.find(n => n.navigation_id === nid) || mockNavigations[0]
      return ok(nav)
    },
  },
  {
    method: 'PUT', path: '/api/navigations/{nav_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/navigations/{nav_id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/navigations/{nav_id}/content',
    handler: (_req, params) => {
      const nid = parseInt(params.nav_id)
      const nav = mockNavigations.find(n => n.navigation_id === nid) || mockNavigations[0]
      return ok(nav.content)
    },
  },
  {
    method: 'PUT', path: '/api/navigations/{nav_id}/content',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/navigations/{nav_id}/status',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/navigations/sort',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/navigations/icons',
    handler: () => ok([]),
  },
  {
    method: 'POST', path: '/api/navigations/init',
    handler: () => ok(null),
  },
]
