export const THINKING_MODE = {
  QUICK_ANSWER: 1,
  DEEP_THINKING: 2,
} as const

export type THINKING_MODE_VALUE = (typeof THINKING_MODE)[keyof typeof THINKING_MODE]

export const SOURCE_TYPE = {
  H5: 'h5',
  API: 'api',
  WEB: 'web',
  CONSOLE: 'console',
} as const

export type SOURCE_TYPE_VALUE = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE]

export const RESPONSE_STATUS = {
  NORMAL: 1,
  REFUSED: 2,
} as const

export type RESPONSE_STATUS_VALUE = (typeof RESPONSE_STATUS)[keyof typeof RESPONSE_STATUS]

export const KNOWLEDGE_TYPE = {
  KNOWLEDGE_BASE: 1,
  WEB: 2,
  SPECIFIED_KNOWLEDGE_BASE: 3,
} as const

export type KNOWLEDGE_TYPE_VALUE = (typeof KNOWLEDGE_TYPE)[keyof typeof KNOWLEDGE_TYPE]

export interface RecordListRequest {
  start_date: number | null
  end_date: number | null
  keyword?: string | null
  agent_id?: string | null
  offset: number
  limit: number
  direction?: string | null
  thinking_mode?: number | null
  response_status?: number | null
  knowledge_type?: number | null
  file_keyword?: string
  source?: string | null
}

export interface ParsedMessage {
  content: string
  role: string
}

export interface RecordItem {
  parsed_message: ParsedMessage[]
  thinking_mode: THINKING_MODE_VALUE
  response_status: RESPONSE_STATUS_VALUE
  knowledge_scope: string
  citation_count: number
  knowledge_type: KNOWLEDGE_TYPE_VALUE
  id: string
  file_name: string
  model_name: string
  user_id: number
  updated_time: number
  message: string
  rag_stats: {
    document_quotations: null
    document_search: null
    file_quotations: null
    performance: null
    type: string
  }
  original_question: string
  source?: string
}

export interface RecordDisplayItem extends Omit<RecordItem, 'updated_time'> {
  thinking_mode_value: string
  response_status_value: string
  knowledge_type_value: string
  updated_time: string
  specified_content: string
  nickname: string
}

