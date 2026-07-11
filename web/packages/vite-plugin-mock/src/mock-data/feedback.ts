import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

export const feedbackRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/feedback',
    handler: () => ok([
      {
        id: 1,
        agent_id: 1,
        user_id: 1,
        message_id: 2,
        feedback_type: 'satisfied',
        reason: '',
        description: 'Very helpful response',
        question: 'How to use the API?',
        eid: 1,
        created_time: now - 3600,
        updated_time: now - 3600,
      },
    ]),
  },
  {
    method: 'POST', path: '/api/feedback',
    handler: () => ok({ id: Date.now() }),
  },
  {
    method: 'GET', path: '/api/feedback/{id}',
    handler: () => ok({ id: 1, feedback_type: 'satisfied' }),
  },
  {
    method: 'PUT', path: '/api/feedback/{id}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/feedback/{id}',
    handler: () => ok(null),
  },
  {
    method: 'GET', path: '/api/feedback/config',
    handler: () => ok({ setting_id: 1, key: 'feedback_enabled', value: 'true', eid: 1, created_time: now, updated_time: now }),
  },
]
