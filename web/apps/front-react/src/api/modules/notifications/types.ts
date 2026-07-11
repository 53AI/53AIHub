export interface NotificationListParams {
  type?: 'system' | 'pending' | 'mention_comment'
  is_read?: 'read' | 'unread'
  sender_user_id?: number
  start_time?: number
  end_time?: number
  offset?: number
  limit?: number
}

export interface NotificationListResponse {
  list: RawNotificationItem[]
  total: number
  offset: number
  limit: number
}

export interface NotificationCreateParams {
  content: string
  sender_user_id: number
  receiver_user_ids: number[]
  type: string
}

export interface NotificationStatsParams {
  scope?: 'all' | 'unread'
}

export interface NotificationStatsResponse {
  total: number
  counts: {
    system: number
    pending: number
    mention_comment: number
  }
}

export interface RawNotificationItem {
  id: number
  sender: {
    user_id: number
    nickname: string
    avatar: string
  }
  type: 'pending' | 'system' | 'mention_comment'
  content: string
  content_parsed: {
    resource_type?: number
    resource?: {
      id: number
      name: string
      icon: string
      library_id?: number
      isfile?: boolean
    }
    permission?: number
    reason?: string
  }
  approval_id: number
  approval: {
    approver_info?: {
      user_id: number
      nickname: string
      avatar: string
    }
    applicant_id: number
    created_time: number
    id: number
    permission: number
    reason: string
    resource_id: number
    resource_type: number
    status: number
    updated_time: number
  }
  is_read: boolean
  created_time: number
  updated_time: number
  receiver_user_id: number
}
