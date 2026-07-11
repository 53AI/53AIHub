import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockConversations = [
  {
    conversation_id: 1,
    title: 'How to use the API?',
    agent_id: 1,
    user_id: 1,
    eid: 1,
    model: 'gpt-4o-mini',
    status: 1,
    total_tokens: 1500,
    quota: 0,
    last_message: 'Here is how you can use the API...',
    file_id: 0,
    channel_conversation_id: '',
    channel_conversation_expiration_time: 0,
    created_time: now - 3600,
    updated_time: now - 1800,
    deleted_time: 0,
  },
  {
    conversation_id: 2,
    title: 'Code review help',
    agent_id: 2,
    user_id: 1,
    eid: 1,
    model: 'gpt-4o',
    status: 1,
    total_tokens: 3200,
    quota: 0,
    last_message: 'I found several issues in your code...',
    file_id: 0,
    channel_conversation_id: '',
    channel_conversation_expiration_time: 0,
    created_time: now - 7200,
    updated_time: now - 3600,
    deleted_time: 0,
  },
]

const mockMessages = [
  {
    id: 1,
    conversation_id: 1,
    role: 'user',
    content: 'Hello, how can I use the API?',
    created_time: now - 3600,
    updated_time: now - 3600,
  },
  {
    id: 2,
    conversation_id: 1,
    role: 'assistant',
    content: 'Here is how you can use the API. First, you need to get an API key...',
    created_time: now - 3500,
    updated_time: now - 3500,
  },
]

export const conversationRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/conversations',
    handler: () => ok({ conversations: mockConversations, count: mockConversations.length }),
  },
  {
    method: 'GET', path: '/api/conversations/{conversation_id}',
    handler: (_req, params) => {
      const cid = parseInt(params.conversation_id)
      const conv = mockConversations.find(c => c.conversation_id === cid) || mockConversations[0]
      return ok(conv)
    },
  },
  {
    method: 'DELETE', path: '/api/conversations/{conversation_id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/conversations/{conversation_id}/messages',
    handler: () => ok({ messages: mockMessages, count: mockMessages.length }),
  },
  {
    method: 'POST', path: '/api/conversations',
    handler: (_req, _params, body) => ok({
      conversation_id: Date.now(),
      title: body?.title || 'New Conversation',
      agent_id: body?.agent_id || 1,
      user_id: 1,
      eid: 1,
      model: 'gpt-4o-mini',
      status: 1,
      total_tokens: 0,
      quota: 0,
      last_message: '',
      file_id: 0,
      channel_conversation_id: '',
      channel_conversation_expiration_time: 0,
      created_time: now,
      updated_time: now,
      deleted_time: 0,
    }),
  },
  {
    method: 'GET', path: '/api/users/{user_id}/conversations',
    handler: () => ok({ conversations: mockConversations, count: mockConversations.length }),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}/conversations',
    handler: () => ok({ conversations: mockConversations, count: mockConversations.length }),
  },
  {
    method: 'GET', path: '/api/agents/{agent_id}/messages',
    handler: () => ok({ messages: mockMessages, count: mockMessages.length }),
  },
]
