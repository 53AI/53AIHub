import request from '../../index'
import type { NotificationListParams, NotificationStatsParams, NotificationStatsResponse, NotificationListResponse } from './types'

const notificationsApi = {
  list(params: NotificationListParams): Promise<NotificationListResponse> {
    return request.get('/api/notifications', { params }).then((res) => res.data)
  },

  stats(params: NotificationStatsParams): Promise<NotificationStatsResponse> {
    return request.get('/api/notifications/stats', { params }).then((res) => res.data)
  },

  read(id: number): Promise<void> {
    return request.put(`/api/notifications/${id}/read`).then((res) => res.data)
  },

  read_all(): Promise<void> {
    return request.put('/api/notifications/read-all').then((res) => res.data)
  }
}

export default notificationsApi
