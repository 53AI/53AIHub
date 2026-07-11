import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const settingsRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/settings',
    handler: () => ok([
      { setting_id: 1, key: 'site_name', value: '53AI Hub', eid: 1, created_time: now, updated_time: now },
      { setting_id: 2, key: 'site_logo', value: '', eid: 1, created_time: now, updated_time: now },
      { setting_id: 3, key: 'allow_register', value: 'true', eid: 1, created_time: now, updated_time: now },
    ]),
  },
  {
    method: 'GET', path: '/api/settings/{id}',
    handler: () => ok({ setting_id: 1, key: 'site_name', value: '53AI Hub', eid: 1, created_time: now, updated_time: now }),
  },
  {
    method: 'PUT', path: '/api/settings/{id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/settings/key/{key}',
    handler: () => ok({ setting_id: 1, key: 'site_name', value: '53AI Hub', eid: 1, created_time: now, updated_time: now }),
  },
  {
    method: 'GET', path: '/api/settings/by-key',
    handler: () => ok({}),
  },
  {
    method: 'GET', path: '/api/settings/group/{group_name}',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/settings/default_links',
    handler: () => ok([]),
  },
]
