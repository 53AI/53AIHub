import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const enterpriseConfigRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/enterprise-configs',
    handler: () => ok([
      { type: 'smtp', enabled: false },
      { type: 'auth_sso', enabled: false },
    ]),
  },
  {
    method: 'GET', path: '/api/enterprise-configs/{type}',
    handler: () => ok({ config: {}, enabled: false }),
  },
  {
    method: 'PUT', path: '/api/enterprise-configs/{type}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/enterprise-configs/{type}/toggle',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/enterprise-configs/{type}/enabled',
    handler: () => ok({ enabled: false }),
  },
]
