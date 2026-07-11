export const CHUNK_STATUS = {
  DISABLED: 'disabled',
  ENABLED: 'enabled',
}

export const CHUNKING_STATUS = {
  CHUNKING: 'chunking',
  EMBEDDING: 'embedding',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

export const EMBEDDING_STATUS = {
  PENDING: 'pending',
  EMBEDDING: 'embedding',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

export const CONVERSION_STATUS = {
  NORMAL: 'normal',
  CONVERTING: 'converting',
  FAILED: 'failed',
}

export const INDEXING_STATUS = {
  NORMAL: 'normal',
  INDEXING: 'indexing',
  FAILED: 'failed',
}

export const PARSING_STATUS = {
  NORMAL: 'normal',
  PARSING: 'parsing',
  FAILED: 'failed',
}

export const NOT_ALLOWED_RESOURCE_EXT = ['txt', 'html', 'htm', 'md']

export const CHUNK_TYPE = {
  RETRIEVAL: 'retrieval',
  SUMMARY: 'summary',
  QUESTION: 'question',
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
      chunk_mode: 'length_first',
    },
    index_chunking: {
      split_rule: 'none',
      max_length: 2000,
      overlap_size: 0,
      include_title: false,
      include_filename: false,
      chunk_mode: 'length_first',
    },
    content_summary: {
      generation_method: 'manual',
    },
    common_questions: {
      generation_method: 'manual',
    },
  },
  created_time: 0,
  updated_time: 0,
}

export const REINDEX_TYPE = {
  RETRIEVAL: 'reindex_retrieval',
  CHUNK: 'rechunk_and_reindex',
}

export type ConversionStatus = (typeof CONVERSION_STATUS)[keyof typeof CONVERSION_STATUS]
export type IndexingStatus = (typeof INDEXING_STATUS)[keyof typeof INDEXING_STATUS]
export type ParsingStatus = (typeof PARSING_STATUS)[keyof typeof PARSING_STATUS]
export type ChunkingStatus = (typeof CHUNKING_STATUS)[keyof typeof CHUNKING_STATUS]
export type EmbeddingStatus = (typeof EMBEDDING_STATUS)[keyof typeof EMBEDDING_STATUS]
export type ChunkType = (typeof CHUNK_TYPE)[keyof typeof CHUNK_TYPE]
export type ChunkStatus = (typeof CHUNK_STATUS)[keyof typeof CHUNK_STATUS]
export type ReindexType = (typeof REINDEX_TYPE)[keyof typeof REINDEX_TYPE]

