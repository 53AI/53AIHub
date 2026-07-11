import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockChannels = [
  {
    channel_id: 1,
    name: 'OpenAI',
    type: 1,
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-mock-***',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    status: 1,
    created_time: now - 86400 * 30,
    updated_time: now,
  },
  {
    channel_id: 2,
    name: 'Local LLM',
    type: 2,
    base_url: 'http://localhost:11434',
    api_key: '',
    models: ['llama3', 'mistral'],
    status: 1,
    created_time: now - 86400 * 14,
    updated_time: now,
  },
]

const mockModels = {
  models: [
    { id: 'gpt-4o', object: 'model', created: now - 86400 * 30, owned_by: 'openai', parent: '', root: 'gpt-4o', permission: [] },
    { id: 'gpt-4o-mini', object: 'model', created: now - 86400 * 30, owned_by: 'openai', parent: '', root: 'gpt-4o-mini', permission: [] },
    { id: 'gpt-3.5-turbo', object: 'model', created: now - 86400 * 60, owned_by: 'openai', parent: '', root: 'gpt-3.5-turbo', permission: [] },
  ],
}

export const channelRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/channels',
    handler: () => ok(mockChannels),
  },
  {
    method: 'GET', path: '/api/channels/public',
    handler: () => ok(mockChannels.filter(c => c.status === 1)),
  },
  {
    method: 'GET', path: '/api/channels/models',
    handler: () => ok(mockModels),
  },
  {
    method: 'GET', path: '/api/channels/km/models',
    handler: () => ok(mockModels),
  },
  {
    method: 'POST', path: '/api/channels',
    handler: (_req, _params, body) => ok({
      channel_id: Date.now(),
      status: 1,
      created_time: now,
      updated_time: now,
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/channels/{channel_id}',
    handler: (_req, params) => {
      const cid = parseInt(params.channel_id)
      const ch = mockChannels.find(c => c.channel_id === cid) || mockChannels[0]
      return ok(ch)
    },
  },
  {
    method: 'PUT', path: '/api/channels/{channel_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/channels/{channel_id}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/channels/test/{channel_id}',
    handler: () => ok({ success: true, message: 'Connection successful' }),
  },
]
