import type { Pipeline, PipelineNode, ParseMethod } from '../types'

/**
 * 向量嵌入配置
 */
export interface VectorEmbeddingConfig {
  channel_id?: string
  model_name?: string
}

/**
 * 向量模型测试结果
 */
export interface VectorTestResult {
  success: boolean
  message: string
}

/**
 * 图谱模板
 */
export interface GraphTemplate {
  id: string
  name: string
  logo?: string
  description?: string
  entity_types?: string[]
  relation_types?: string[]
}

/**
 * 管线列表查询参数
 */
export interface PipelineListParams {
  page?: number
  pageSize?: number
  keyword?: string
}

/**
 * 管线列表响应
 */
export interface PipelineListResponse {
  list: Pipeline[]
  total: number
  page: number
  pageSize: number
}

/**
 * 管线创建参数
 */
export interface PipelineCreateParams {
  name: string
  description?: string
  icon?: string
  profile_json?: {
    steps: PipelineNode[]
  }
}

/**
 * 管线更新参数
 */
export interface PipelineUpdateParams {
  id: string | number
  name?: string
  description?: string
  icon?: string
  profile_json?: {
    steps: PipelineNode[]
  }
}

/**
 * Data Pipeline 适配器接口
 *
 * 应用层需要实现此接口，提供数据获取和操作的方法
 */
export interface IDataPipelineAdapter {
  /** 获取管线列表 */
  getPipelines(params?: PipelineListParams): Promise<PipelineListResponse>
  /** 获取单个管线详情 */
  getPipeline(id: string | number): Promise<Pipeline>
  /** 创建管线 */
  createPipeline(params: PipelineCreateParams): Promise<Pipeline>
  /** 更新管线 */
  updatePipeline(params: PipelineUpdateParams): Promise<Pipeline>
  /** 删除管线 */
  deletePipeline(id: string | number): Promise<void>

  // ========== 配置组件数据获取方法 ==========

  /** 获取解析方法列表（用于 ParseConfig） */
  getParseMethods?(): Promise<ParseMethod[]>

  /** 获取向量嵌入配置（用于 VectorConfig） */
  getVectorEmbedding?(): Promise<VectorEmbeddingConfig | null>
  /** 测试向量模型是否可用（用于 VectorConfig） */
  testVectorModel?(channelId: string, modelName: string): Promise<VectorTestResult>

  /** 获取图谱模板列表（用于 GraphConfig） */
  getGraphTemplates?(): Promise<GraphTemplate[]>

  // ========== 渲染器方法（可选） ==========

  /** 渲染模型图标 */
  renderModelIcon?(channelId: string, modelName: string): React.ReactNode
  /** 渲染模型名称 */
  renderModelName?(channelId: string, modelName: string): React.ReactNode
  /** 渲染提供商名称 */
  renderProviderName?(channelId: string, modelName: string): React.ReactNode

  // ========== 导航方法 ==========

  /** 跳转到模型管理页面 */
  goToModelManagement?(): void

  // ========== 公共路径方法 ==========

  /** 获取公共资源路径 */
  getPublicPath?(path: string): string
}

/**
 * 适配器上下文值
 */
export interface AdapterContextValue {
  adapter?: IDataPipelineAdapter
  isReady: boolean
}