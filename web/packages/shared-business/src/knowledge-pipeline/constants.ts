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
 * Node name i18n key mapping
 * Used to resolve node nwames at runtime via i18n
 */
export const STEP_KEY_TO_NAME_I18N_KEY: Record<string, string> = {
  document_parsing: 'data_pipeline.node_document_parsing',
  content_cleaning: 'data_pipeline.node_content_cleaning',
  summary_generation: 'data_pipeline.node_summary_generation',
  document_chunking: 'data_pipeline.node_document_chunking',
  vector_indexing: 'data_pipeline.node_vector_indexing',
  graph_generation: 'data_pipeline.node_graph_generation',
}

/**
 * Node description i18n key mapping
 * Used to resolve node descriptions at runtime via i18n
 */
export const STEP_KEY_TO_DESCRIPTION_I18N_KEY: Record<string, string> = {
  document_parsing: 'data_pipeline.node_desc_document_parsing',
  content_cleaning: 'data_pipeline.node_desc_content_cleaning',
  summary_generation: 'data_pipeline.node_desc_summary_generation',
  document_chunking: 'data_pipeline.node_desc_document_chunking',
  vector_indexing: 'data_pipeline.node_desc_vector_indexing',
  graph_generation: 'data_pipeline.node_desc_graph_generation',
}

/**
 * Node types displayed in list view
 * Simplified display of core process nodes
 * Note: summary_generation is temporarily hidden
 */
export const LIST_DISPLAY_NODE_TYPES = [
  'document_parsing',
  // 'summary_generation', // TODO: 暂时隐藏
  'document_chunking',
  'vector_indexing',
  'graph_generation',
]

/**
 * Default pipeline node configuration
 * Note: name and description are i18n keys, should be resolved at runtime
 */
export const DEFAULT_PIPELINE_STEP: PipelineNode[] = [
  {
    step_key: 'document_parsing',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME_I18N_KEY.document_parsing,
    description: STEP_KEY_TO_DESCRIPTION_I18N_KEY.document_parsing,
    config: {
      engine: 'markitdown',
      enable_smart_match: false,
    },
  },
  {
    step_key: 'document_chunking',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME_I18N_KEY.document_chunking,
    description: STEP_KEY_TO_DESCRIPTION_I18N_KEY.document_chunking,
    config: {
      chunk_type: 'default',
      enable_smart_match: false,
      match_preference_prompt: '',
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
    name: STEP_KEY_TO_NAME_I18N_KEY.vector_indexing,
    description: STEP_KEY_TO_DESCRIPTION_I18N_KEY.vector_indexing,
    config: {},
  },
  // {
  //   step_key: 'summary_generation',
  //   run_mode: 'auto',
  //   name: STEP_KEY_TO_NAME_I18N_KEY.summary_generation,
  //   description: STEP_KEY_TO_DESCRIPTION_I18N_KEY.summary_generation,
  //   config: {
  //     summary_faq: { enabled: true },
  //     entity_extraction: { enabled: true },
  //     knowledge_map: { enabled: false },
  //   },
  // }, // TODO: 暂时隐藏
  {
    step_key: 'graph_generation',
    run_mode: 'skip',
    name: STEP_KEY_TO_NAME_I18N_KEY.graph_generation,
    description: STEP_KEY_TO_DESCRIPTION_I18N_KEY.graph_generation,
    config: { graph_template_id: '', enable_smart_match: true, enable_smart_generation: true },
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

// Chunk config constants
export const CHUNK_TYPE_OPTIONS = [
  { value: 'default', label: 'data_pipeline.chunk_type_default' },
  { value: 'semantic', label: 'data_pipeline.chunk_type_semantic' },
  { value: 'recursive', label: 'data_pipeline.chunk_type_recursive' },
]

export const SPLIT_TYPE_OPTIONS = [
  { value: 'identifier', label: 'data_pipeline.split_type_identifier' },
  { value: 'length', label: 'data_pipeline.split_type_length' },
]

export const IDENTIFIER_LEVEL_OPTIONS = [
  { value: 'h1', label: 'data_pipeline.identifier_h1' },
  { value: 'h2', label: 'data_pipeline.identifier_h2' },
  { value: 'h3', label: 'data_pipeline.identifier_h3' },
]

// Escape character map for special characters in clean config
export const ESCAPE_MAP: Record<string, string> = {
  '\\n': '\n',
  '\\r': '\r',
  '\\t': '\t',
  '\\s': ' ',
}

export const REVERSE_ESCAPE_MAP: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  ' ': '\\s',
}