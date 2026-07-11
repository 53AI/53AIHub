import { t } from '@/locales'
import type { Pipeline, PipelineNode } from './types'

/**
 * 节点图标映射表
 * 遵循"单一事实来源"原则，统一管理图标
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
 * 节点名称 i18n key 映射表（初始化为当前语言，仅用于默认节点 name 字段）
 */
export const STEP_KEY_TO_NAME: Record<string, string> = {
  document_parsing: t('data_pipeline.node_document_parsing'),
  content_cleaning: t('data_pipeline.node_content_cleaning'),
  summary_generation: t('data_pipeline.node_summary_generation'),
  document_chunking: t('data_pipeline.node_document_chunking'),
  vector_indexing: t('data_pipeline.node_vector_indexing'),
  graph_generation: t('data_pipeline.node_graph_generation'),
}

/**
 * 节点描述 i18n key 映射表（初始化为当前语言，仅用于默认节点 description 字段）
 */
export const STEP_KEY_TO_DESCRIPTION: Record<string, string> = {
  document_parsing: t('data_pipeline.node_desc_document_parsing'),
  content_cleaning: t('data_pipeline.node_desc_content_cleaning'),
  summary_generation: t('data_pipeline.node_desc_summary_generation'),
  document_chunking: t('data_pipeline.node_desc_document_chunking'),
  vector_indexing: t('data_pipeline.node_desc_vector_indexing'),
  graph_generation: t('data_pipeline.node_desc_graph_generation'),
}

/**
 * 列表页显示的节点类型
 * 精简显示核心流程节点
 */
export const LIST_DISPLAY_NODE_TYPES = [
  'document_parsing',
  'summary_generation',
  'document_chunking',
  'vector_indexing',
  'graph_generation',
]

/**
 * 默认管线节点配置
 * 结构清晰，便于维护
 */
export const DEFAULT_PIPELINE_STEP: PipelineNode[] = [
  {
    step_key: 'document_parsing',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.document_parsing as string,
    description: STEP_KEY_TO_DESCRIPTION.document_parsing as string,
    config: {
      engine: 'markitdown',
      enable_smart_match: false,
    },
  },
  {
    step_key: 'document_chunking',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.document_chunking as string,
    description: STEP_KEY_TO_DESCRIPTION.document_chunking as string,
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
    name: STEP_KEY_TO_NAME.vector_indexing as string,
    description: STEP_KEY_TO_DESCRIPTION.vector_indexing as string,
    config: {},
  },
  {
    step_key: 'summary_generation',
    run_mode: 'auto',
    name: STEP_KEY_TO_NAME.summary_generation as string,
    description: STEP_KEY_TO_DESCRIPTION.summary_generation as string,
    config: {
      summary_faq: { enabled: true },
      entity_extraction: { enabled: true },
      knowledge_map: { enabled: false },
    },
  },
  {
    step_key: 'graph_generation',
    run_mode: 'skip',
    name: STEP_KEY_TO_NAME.graph_generation as string,
    description: STEP_KEY_TO_DESCRIPTION.graph_generation as string,
    config: { graph_template_id: '', enable_smart_match: true, enable_smart_generation: true },
  },
]

/**
 * 创建新管线的工厂函数
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
