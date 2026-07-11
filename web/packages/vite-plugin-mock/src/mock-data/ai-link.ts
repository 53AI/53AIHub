import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const aiLinkRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/ai_links',
    handler: () => ok([
      {
        id: 1,
        name: 'AI Assistant Link',
        description: 'Quick access to AI assistant',
        url: 'https://example.com/ai',
        logo: '',
        sort: 0,
        group_id: 0,
        eid: 1,
        shared_account: '',
        user_group_ids: [],
        subscription_group_ids: [],
        created_time: now - 86400 * 7,
        updated_time: now,
      },
    ]),
  },
  {
    method: 'GET', path: '/api/ai_links/current',
    handler: () => ok([]),
  },
  {
    method: 'GET', path: '/api/ai_links/default',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/ai_links',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'GET', path: '/api/ai_links/{id}',
    handler: () => ok({ id: 1, name: 'AI Assistant Link' }),
  },
  {
    method: 'PUT', path: '/api/ai_links/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/ai_links/{id}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/ai_links/batch/sort',
    handler: () => ok(null),
  },
]
