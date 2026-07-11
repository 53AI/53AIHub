import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const providerRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/providers',
    handler: () => ok([
      { id: 1, name: 'OpenAI', type: 'openai', status: 1, created_time: now, updated_time: now },
      { id: 2, name: 'Azure OpenAI', type: 'azure', status: 1, created_time: now, updated_time: now },
    ]),
  },
  {
    method: 'POST', path: '/api/providers',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'GET', path: '/api/providers/{id}',
    handler: () => ok({ id: 1, name: 'OpenAI', type: 'openai', status: 1 }),
  },
  {
    method: 'PUT', path: '/api/providers/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/providers/{id}',
    handler: () => ok(null),
  },
]
