import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockNotifications = [
  {
    id: 1,
    type: 'system',
    title: 'System Update',
    content: 'The system has been updated to the latest version.',
    is_read: false,
    user_id: 1,
    created_time: now - 3600,
  },
  {
    id: 2,
    type: 'mention',
    title: 'New Mention',
    content: 'You were mentioned in a conversation.',
    is_read: true,
    user_id: 1,
    created_time: now - 7200,
  },
]

export const notificationRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/notifications',
    handler: () => ({ list: mockNotifications, total: mockNotifications.length, offset: 0, limit: 20 }),
  },
  {
    method: 'GET', path: '/api/notifications/stats',
    handler: () => ({ counts: { unread: 1 }, total: mockNotifications.length }),
  },
  {
    method: 'PATCH', path: '/api/notifications/{id}/read',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/notifications/batch',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/notifications/read-all',
    handler: () => ok(null),
  },
]
