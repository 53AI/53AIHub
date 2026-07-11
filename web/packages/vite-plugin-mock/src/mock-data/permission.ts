import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockPermissions = [
  { permission_id: 1, resource_type: 'library', resource_id: 1, user_id: 1, max_permission: 10000 },
  { permission_id: 2, resource_type: 'space', resource_id: 1, user_id: 1, max_permission: 10000 },
]

export const permissionRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/permissions',
    handler: () => ok(mockPermissions),
  },
  {
    method: 'GET', path: '/api/permissions/my',
    handler: () => ok({ max_permission: 10000, resource_id: 0, resource_type: 0 }),
  },
  {
    method: 'GET', path: '/api/permissions/detail',
    handler: () => ok(mockPermissions),
  },
  {
    method: 'GET', path: '/api/permissions/{resource_type}/{resource_id}',
    handler: () => ok({ max_permission: 10000 }),
  },
  {
    method: 'POST', path: '/api/permissions',
    handler: () => ok(null),
  },
  {
    method: 'PUT', path: '/api/permissions/{permission_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/permissions/{permission_id}',
    handler: () => ok(null),
  },
]
