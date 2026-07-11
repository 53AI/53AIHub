import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockPrompts = [
  {
    prompt_id: 1,
    name: 'Code Reviewer',
    description: 'Reviews code for best practices and bugs',
    content: 'You are an expert code reviewer. Analyze the following code...',
    logo: '',
    type: 1,
    status: 1,
    eid: 1,
    user_id: 1,
    likes: 15,
    views: 120,
    is_liked: false,
    sort: 0,
    group_ids: [],
    ai_links: '[]',
    ai_links_data: [],
    custom_config: '',
    created_time: now - 86400 * 14,
    updated_time: now - 3600,
  },
  {
    prompt_id: 2,
    name: 'Technical Writer',
    description: 'Writes clear technical documentation',
    content: 'You are a technical writer. Create documentation for...',
    logo: '',
    type: 1,
    status: 1,
    eid: 1,
    user_id: 1,
    likes: 8,
    views: 65,
    is_liked: true,
    sort: 1,
    group_ids: [],
    ai_links: '[]',
    ai_links_data: [],
    custom_config: '',
    created_time: now - 86400 * 7,
    updated_time: now - 7200,
  },
]

export const promptRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/prompts',
    handler: () => ok({ prompts: mockPrompts, count: mockPrompts.length }),
  },
  {
    method: 'GET', path: '/api/prompts/admin',
    handler: () => ok({ prompts: mockPrompts, count: mockPrompts.length }),
  },
  {
    method: 'GET', path: '/api/prompts/personal',
    handler: () => ok({ prompts: [], count: 0 }),
  },
  {
    method: 'GET', path: '/api/prompts/system',
    handler: () => ok({ prompts: mockPrompts, count: mockPrompts.length }),
  },
  {
    method: 'POST', path: '/api/prompts',
    handler: (_req, _params, body) => ok({
      prompt_id: Date.now(),
      eid: 1,
      user_id: 1,
      likes: 0,
      views: 0,
      is_liked: false,
      sort: mockPrompts.length,
      group_ids: [],
      ai_links: '[]',
      ai_links_data: [],
      custom_config: '',
      created_time: now,
      updated_time: now,
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/prompts/{pid}',
    handler: (_req, params) => {
      const pid = parseInt(params.pid)
      const prompt = mockPrompts.find(p => p.prompt_id === pid) || mockPrompts[0]
      return ok(prompt)
    },
  },
  {
    method: 'PUT', path: '/api/prompts/{pid}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/prompts/{pid}',
    handler: () => ok(null),
  },
  {
    method: 'PATCH', path: '/api/prompts/{pid}/status',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/prompts/{pid}/like',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/prompts/{pid}/groups',
    handler: () => ok([]),
  },
]
