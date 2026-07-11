import request from '../index'

export default {
  list: (params?: { group_id?: number; keyword?: string }) =>
    request.get('/api/ai_links', { params }),

  currentList: () =>
    request.get('/api/ai_links/current'),

  detail: (id: number) =>
    request.get(`/api/ai_links/${id}`),
}
