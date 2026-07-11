import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockUser = {
  user_id: 1,
  username: 'admin',
  nickname: 'Admin',
  avatar: '',
  email: 'admin@mock.com',
  mobile: '13800138000',
  role: 10000,
  status: 1,
  type: 1,
  eid: 1,
  group_id: 0,
  group_ids: [],
  related_id: 0,
  created_time: now - 86400 * 30,
  updated_time: now,
  last_login_time: now,
  expired_time: 0,
  add_admin_time: now - 86400 * 30,
  departments: [{ did: 1, name: 'Default', pdid: 0, path: '/1', eid: 1, sort: 0, from: 0, created_time: now, updated_time: now }],
  memberbindings: [],
  openid: '',
  unionid: '',
  access_token: 'mock-access-token',
}

const mockUsers = [mockUser, {
  ...mockUser,
  user_id: 2,
  username: 'user1',
  nickname: 'User One',
  email: 'user1@mock.com',
  role: 1,
  departments: [],
  add_admin_time: 0,
}, {
  ...mockUser,
  user_id: 3,
  username: 'user2',
  nickname: 'User Two',
  email: 'user2@mock.com',
  role: 1,
  departments: [],
  add_admin_time: 0,
}]

export const userRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/users/me',
    handler: () => ok(mockUser),
  },
  {
    method: 'GET', path: '/api/users',
    handler: () => ok({ users: mockUsers, count: mockUsers.length }),
  },
  {
    method: 'GET', path: '/api/users/admin',
    handler: () => ok({ users: [mockUser], count: 1 }),
  },
  {
    method: 'GET', path: '/api/users/internal',
    handler: () => ok({ users: mockUsers, count: mockUsers.length }),
  },
  {
    method: 'POST', path: '/api/users/internal/batch',
    handler: () => ok(null),
  },
  {
    method: 'PUT', path: '/api/users/internal/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/users/{id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/users/{id}/status',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/users/{id}/email',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/users/{id}/mobile',
    handler: () => ok(null),
  },
  {
    method: 'PUT', path: '/api/users/password',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/users/organization',
    handler: () => ok({ users: mockUsers, count: mockUsers.length }),
  },
  {
    method: 'PUT', path: '/api/users/batch/admin',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/users/batch/admin',
    handler: () => ok(null),
  },
  {
    method: 'PUT', path: '/api/users/register/to/internal',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/users/system_log',
    handler: () => ok({ logs: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/users/{id}',
    handler: (_req, params) => {
      const uid = parseInt(params.id)
      const user = mockUsers.find(u => u.user_id === uid) || mockUser
      return ok(user)
    },
  },
  {
    method: 'PUT', path: '/api/users/{id}',
    handler: () => ok(null),
  },
]
