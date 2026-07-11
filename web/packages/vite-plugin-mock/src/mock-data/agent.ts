import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockAgents = [
  {
    agent_id: 1,
    name: 'General Assistant',
    description: 'A general-purpose AI assistant',
    logo: '',
    model: 'gpt-4o-mini',
    prompt: 'You are a helpful assistant.',
    agent_type: 1,
    agent_usage: 1,
    bot_id: '',
    channel_type: 0,
    configs: '{}',
    conversation_count: 42,
    created_by: 1,
    created_time: now - 86400 * 7,
    custom_config: '',
    eid: 1,
    enable: true,
    group_id: 0,
    settings: '{}',
    sort: 0,
    tools: '[]',
    updated_time: now - 3600,
    use_cases: '',
    user_group_ids: [],
  },
  {
    agent_id: 2,
    name: 'Code Expert',
    description: 'Specialized in code generation and review',
    logo: '',
    model: 'gpt-4o',
    prompt: 'You are a code expert.',
    agent_type: 1,
    agent_usage: 1,
    bot_id: '',
    channel_type: 0,
    configs: '{}',
    conversation_count: 15,
    created_by: 1,
    created_time: now - 86400 * 3,
    custom_config: '',
    eid: 1,
    enable: true,
    group_id: 0,
    settings: '{}',
    sort: 1,
    tools: '[]',
    updated_time: now - 7200,
    use_cases: '',
    user_group_ids: [],
  },
  {
    agent_id: 3,
    name: 'Knowledge Navigator',
    description: 'Helps you navigate and search knowledge bases',
    logo: '',
    model: 'gpt-4o-mini',
    prompt: 'You are a knowledge navigator.',
    agent_type: 1,
    agent_usage: 1,
    bot_id: '',
    channel_type: 0,
    configs: '{}',
    conversation_count: 28,
    created_by: 1,
    created_time: now - 86400 * 5,
    custom_config: '',
    eid: 1,
    enable: true,
    group_id: 0,
    settings: '{}',
    sort: 2,
    tools: '[]',
    updated_time: now - 1800,
    use_cases: '',
    user_group_ids: [],
  },
]

export const agentRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/agents',
    handler: () => ok({ agents: mockAgents, count: mockAgents.length }),
  },
  {
    method: 'GET', path: '/api/agents/available',
    handler: () => ok({ agents: mockAgents, count: mockAgents.length }),
  },
  {
    method: 'GET', path: '/api/agents/current',
    handler: () => ok(mockAgents[0]),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}',
    handler: (_req, params) => {
      const aid = parseInt(params.agent_id)
      const agent = mockAgents.find(a => a.agent_id === aid) || mockAgents[0]
      return ok(agent)
    },
  },
  {
    method: 'POST', path: '/api/agents',
    handler: (_req, _params, body) => ok({
      ...mockAgents[0],
      agent_id: Date.now(),
      ...body,
    }),
  },
  {
    method: 'PUT', path: '/api/agents/{agent_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/agents/{agent_id}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/agents/{agent_id}/status',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}/conversations',
    handler: () => ok({ conversations: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}/messages',
    handler: () => ok({ messages: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}/models',
    handler: () => ok({ models: [], count: 0 }),
  },
  {
    method: 'POST', path: '/api/agents/{agent_id}/models',
    handler: () => ok(null),
  },
  {
    method: 'PUT', path: '/api/agents/{agent_id}/models/{model_id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/agents/{agent_id}/models/{model_id}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/agents/group',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/agents/internal_users',
    handler: () => ok({ users: [], count: 0 }),
  },
  {
    method: 'POST', path: '/api/agents/models/batch',
    handler: () => ok(null),
  },
]
