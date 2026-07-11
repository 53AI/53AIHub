export const CHUNK_STATUS = {
  DISABLED: 'disabled',
  ENABLED: 'enabled'
}

export const CHUNKING_STATUS = {
  CHUNKING: 'chunking',
  EMBEDDING: 'embedding',
  COMPLETED: 'completed',
  FAILED: 'failed'
}

export const EMBEDDING_STATUS = {
  PENDING: 'pending',
  PARSING: 'parsing',
  NORMAL: 'normal',
  COMPLETED: 'completed',
  FAILED: 'failed'
}


export const PARSING_STATUS = {
  INACTIVE: 'inactive', // 未激活，默认
  NORMAL: 'normal',
  PENDING: 'pending',
  PARSING: 'parsing',
  FAILED: 'failed',
}

export const AI_GENERATE_CHUNK_STATUS = {
  INACTIVE: 'inactive',
  PENDING: 'pending',
  NORMAL: 'normal',
  PARSING: 'parsing',
  FAILED: 'failed',
}

// 任务状态
export const RAG_JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAUSED: 'paused',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
}

/**
 * 运行状态枚举
 */
export const RUN_STATUS = {
  /** 排队中 */
  PENDING: 'pending',
  /** 处理中 */
  PROCESSING: 'processing',
  /** 手动文档解析 */
  WAITING: 'waiting',
  /** 暂停 */
  PAUSED: 'paused',
  /** 成功 */
  SUCCESS: 'success',
  /** 失败 */
  FAILED: 'failed'
} as const

/**
 * 运行状态类型
 */
export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS]

/**
 * 不允许查看源文件的资源扩展名
 */
export const NOT_ALLOWED_RESOURCE_EXT = [
  'txt', 'html', 'htm', 'md'
]

export const CHUNK_TYPE = {
  // 检索块
  RETRIEVAL: 'retrieval',
  // 摘要块
  SUMMARY: 'summary',
  // 常见问题块
  QUESTION: 'question'
}

export const CHUNK_SETTING_DEFAULT = {
  id: 0,
  eid: 0,
  library_id: null,
  file_id: null,
  chunking_config: {
    version: '1.0',
    knowledge_chunking: {
      split_rule: 'none',
      max_length: 2000,
      overlap_size: 0,
      include_title: false,
      include_filename: false,
      chunk_mode: 'length_first'
    },
    index_chunking: {
      split_rule: 'none',
      max_length: 2000,
      overlap_size: 0,
      include_title: false,
      include_filename: false,
      chunk_mode: 'length_first'
    },
    content_summary: {
      generation_method: 'manual'
    },
    common_questions: {
      generation_method: 'manual'
    }
  },
  created_time: 0,
  updated_time: 0
}


export const REINDEX_TYPE = {
  RETRIEVAL: 'reindex_retrieval',
  CHUNK: 'rechunk_and_reindex'
}



export type AIGenerateChunkStatus = (typeof AI_GENERATE_CHUNK_STATUS)[keyof typeof AI_GENERATE_CHUNK_STATUS]
export type ChunkingStatus = (typeof CHUNKING_STATUS)[keyof typeof CHUNKING_STATUS]
export type EmbeddingStatus = (typeof EMBEDDING_STATUS)[keyof typeof EMBEDDING_STATUS]
export type ChunkType = (typeof CHUNK_TYPE)[keyof typeof CHUNK_TYPE]
export type ChunkStatus = (typeof CHUNK_STATUS)[keyof typeof CHUNK_STATUS]
export type ReindexType = (typeof REINDEX_TYPE)[keyof typeof REINDEX_TYPE]
