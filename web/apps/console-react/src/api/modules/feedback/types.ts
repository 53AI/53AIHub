export interface FeedbackListRequest {
  start_time: number | null
  end_time: number | null
  question?: string | null
  feedback_type?: string | null
  user_id?: string | null
  reason?: string | null
  offset: number
  limit: number
  agent_id?: string | number | null
}

export interface FeedbackItem {
  created_time: number
  description: string
  eid: string
  feedback_type: string
  id: string
  message_id: string
  question: string
  reason: string
  updated_time: number
  user_id: number
  message_info?: {
    model_name: string
    original_question: string
  }
  user_info: {
    nickname: string
  }
  model_name: string
  nickname: string
  rewritten_question: string
}

export interface FeedbackDisplayItem extends Omit<FeedbackItem, 'updated_time'> {
  updated_time: string
  original_question: string
}

export const SEARCH_TYPE = {
  FEEDBACK: 'feedback',
  RECORD: 'record',
} as const

export type SearchType = (typeof SEARCH_TYPE)[keyof typeof SEARCH_TYPE]

