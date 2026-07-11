import type { Pipeline, PipelineNode } from './types'

/**
 * Node icon mapping
 * Following the "single source of truth" principle, unified icon management
 */
export const NODE_ICONS_MAP: Record<string, string> = {
  document_parsing: 'view-list',
  content_cleaning: 'paragraph-cut',
  summary_generation: 'notes',
  document_chunking: 'split-cells',
  vector_indexing: 'clue',
  graph_generation: 'six-points',
}

/**
 * Node name mapping
 */
export const STEP_KEY_TO_NAME: Record<string, string> = {
  document_parsing: '文档解析',
  content_cleaning: '内容清洗',
  summary_generation: '生成摘要',
  document_chunking: '语料拆分',
  vector_indexing: '向量索引',
  graph_generation: '图谱生成',
}

export const STEP_KEY_TO_DESCRIPTION: Record<string, string> = {
  document_parsing: '转文档为可处理的结构化文本',
  content_cleaning: '规整文本，去冗余、修格式',
  summary_generation: '生成文档摘要、文档标签与知识地图',
  document_chunking: '拆分文档内容为语料片段',
  vector_indexing: '拆分文本并建索引，便于检索',
  graph_generation: '选择本体，提取信息，用图谱呈现内容关联',
}

/**
 * Node types displayed in list view
 * Simplified display of core process nodes
 */
export const LIST_DISPLAY_NODE_TYPES = [
  'document_parsing',
  'summary_generation',
  'document_chunking',
  'vector_indexing',
  'graph_generation',
]

/**
 * Default pipeline node configuration
 * Clear structure for easy maintenance
 */
export const DEFAULT_PIPELINE_STEP: PipelineNode[] = [
  {
    step_key: 'document_parsing',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.document_parsing,
    description: STEP_KEY_TO_DESCRIPTION.document_parsing,
    config: {
      engine: 'markitdown',
    },
  },
  {
    step_key: 'document_chunking',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.document_chunking,
    description: STEP_KEY_TO_DESCRIPTION.document_chunking,
    config: {
      chunk_type: 'default',
      parent_chunk: {
        mode: 'custom',
        strategy: 'identifier',
        identifier_level: 'h2',
        max_length: 2048,
        append_filename: true,
        append_title: true,
        append_subtitle: true,
      },
      child_chunk: {
        mode: 'custom',
        strategy: 'length',
        identifier_level: 'h3',
        max_length: 512,
      },
      index_enhancement: {
        metadata_injection: {
          append_filename: true,
          append_title: true,
          append_subtitle: true,
        },
        generative_enhancement: {
          generate_summary: true,
          generate_faq: true,
        },
      },
    },
  },
  {
    step_key: 'vector_indexing',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.vector_indexing,
    description: STEP_KEY_TO_DESCRIPTION.vector_indexing,
    config: {},
  },
  {
    step_key: 'summary_generation',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.summary_generation,
    description: STEP_KEY_TO_DESCRIPTION.summary_generation,
    config: {
      summary_faq: { enabled: true },
      entity_extraction: { enabled: true },
      knowledge_map: { enabled: false },
    },
  },
  {
    step_key: 'graph_generation',
    run_mode: 'skip',
    name: STEP_KEY_TO_NAME.graph_generation,
    description: STEP_KEY_TO_DESCRIPTION.graph_generation,
    config: { graph_template_id: '', enable_smart_match: false, enable_smart_generation: false },
  },
]

/**
 * Factory function to create new pipeline
 */
export const createNewPipeline = (): Pipeline => ({
  id: '',
  name: '',
  icon: '',
  created_at: new Date().toLocaleString(),
  profile_json: {
    steps: JSON.parse(JSON.stringify(DEFAULT_PIPELINE_STEP)),
  },
  stats: { total: 0, success_rate: 0 },
})
