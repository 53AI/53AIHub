/**
 * Console React 数据管线适配器实现
 */
import React from 'react'
import type {
  IDataPipelineAdapter,
  Pipeline,
  PipelineListParams,
  PipelineListResponse,
  PipelineCreateParams,
  PipelineUpdateParams,
  ParseMethod,
  VectorEmbeddingConfig,
  VectorTestResult,
  GraphTemplate,
} from '@km/shared-business/knowledge-pipeline'
import { ragPipelineApi } from '@/api/modules/rag-pipeline'
import { uploadApi } from '@/api/modules/upload'
import { api_host, getPublicPath } from '@/utils/config'
import { getSimpleParserConfigs } from '@/constants/parser'
import platformSettingsApi from '@/api/modules/platform-settings'
import { transformPlatformSetting } from '@/api/modules/platform-settings/transform'
import { chunkSettingApi } from '@/api/modules/chunk-setting'
import { graphTemplatesApi } from '@/api/modules/graph-templates'
import channelApi from '@/api/modules/channel'
import { ModelView } from '@/components/Model/view'

/**
 * 将 API Pipeline 转换为前端 Pipeline
 */
const transformApiPipeline = (apiPipeline: any): Pipeline => {
  const profileJson = typeof apiPipeline.profile_json === 'string'
    ? JSON.parse(apiPipeline.profile_json)
    : apiPipeline.profile_json

  // 格式化创建时间
  const created_at = apiPipeline.created_time
    ? new Date(apiPipeline.created_time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(/\//g, '-')
    : ''

  // 默认图标
  const defaultIcon = api_host + '/api/images/library/pipeline-icon.png.png'

  return {
    id: apiPipeline.id,
    name: apiPipeline.name,
    icon: apiPipeline.icon || defaultIcon,
    created_at,
    profile_json: profileJson,
    stats: {
      total: apiPipeline.stats?.success_count || 0,
      success_rate: apiPipeline.stats?.success_rate
        ? Number((apiPipeline.stats.success_rate * 100).toFixed(1))
        : 0,
    },
  }
}

/**
 * 创建数据管线适配器
 */
export function createPipelineAdapter(): IDataPipelineAdapter {
  return {
    // ========== 管线 CRUD ==========

    async getPipelines(params?: PipelineListParams): Promise<PipelineListResponse> {
      const data = await ragPipelineApi.getList()
      const pipelines = (data || []).map(transformApiPipeline)
      return {
        list: pipelines,
        total: pipelines.length,
        page: params?.page || 1,
        pageSize: params?.pageSize || pipelines.length,
      }
    },

    async getPipeline(id: string | number): Promise<Pipeline> {
      const data = await ragPipelineApi.getById(id)
      return transformApiPipeline(data)
    },

    async createPipeline(params: PipelineCreateParams): Promise<Pipeline> {
      // 处理图标上传
      let icon = params.icon || ''
      if (icon && icon.startsWith('blob:')) {
        icon = await uploadIcon(icon)
      }

      const data = await ragPipelineApi.create({
        name: params.name,
        icon: icon,
        profile_json: params.profile_json || { steps: [] },
      })
      return transformApiPipeline(data)
    },

    async updatePipeline(params: PipelineUpdateParams): Promise<Pipeline> {
      // 处理图标上传
      let icon = params.icon || ''
      if (icon && icon.startsWith('blob:')) {
        icon = await uploadIcon(icon)
      }

      const data = await ragPipelineApi.update(params.id, {
        name: params.name,
        icon: icon,
        profile_json: params.profile_json || { steps: [] },
      })
      return transformApiPipeline(data)
    },

    async deletePipeline(id: string | number): Promise<void> {
      await ragPipelineApi.delete(id)
    },

    // ========== 配置组件数据获取 ==========

    async getParseMethods(): Promise<ParseMethod[]> {
      const parserConfigs = getSimpleParserConfigs()

      // 获取平台设置
      const res = await platformSettingsApi.find()
      const settingsMap: Record<string, any> = {}
      res.forEach((item: any) => {
        if (parserConfigs.find((pc: any) => pc.key === item.platform_key)) {
          settingsMap[item.platform_key] = transformPlatformSetting(item)
        }
      })

      return parserConfigs
        .filter((pc: any) => pc.key === 'markitdown' || settingsMap[pc.key])
        .map((pc: any) => ({
          key: pc.key === 'markitdown' ? 'markitdown' : pc.key,
          name: pc.name,
          desc: pc.desc || '由系统提供的解析服务',
          icon: pc.icon,
          detailedDesc: pc.detailedDesc,
        }))
    },

    async getVectorEmbedding(): Promise<VectorEmbeddingConfig | null> {
      try {
        const data = await chunkSettingApi.modelConfig.get()
        return data.model_config?.vector_embedding || null
      } catch (error) {
        console.error('Get vector embedding error:', error)
        return null
      }
    },

    async testVectorModel(channelId: string, modelName: string): Promise<VectorTestResult> {
      try {
        const result = await channelApi.test(Number(channelId), {
          model: modelName,
          model_type: 2, // EMBEDDING type
        })
        return {
          success: result.success,
          message: result.message,
        }
      } catch (error) {
        console.error('Test vector model error:', error)
        return {
          success: false,
          message: String(error),
        }
      }
    },

    async getGraphTemplates(): Promise<GraphTemplate[]> {
      try {
        const res = await graphTemplatesApi.list({ offset: 0, limit: 50 })
        const defaultLogo = `${api_host}/api/images/library/graph-icon.png`
        return (res.items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          logo: item.logo || defaultLogo,
          description: item.description,
          entity_types: item.entities,
          relation_types: item.relations,
        }))
      } catch (error) {
        console.error('Get graph templates error:', error)
        return []
      }
    },

    // ========== 渲器方法 ==========

    renderModelIcon(channelId: string, modelName: string): React.ReactNode {
      return (
        <ModelView
          channelId={channelId}
          model={modelName}
          type="icon"
          size={40}
        />
      )
    },

    renderProviderName(channelId: string, modelName: string): React.ReactNode {
      return (
        <ModelView
          channelId={channelId}
          model={modelName}
          type="provider_name"
        />
      )
    },

    renderModelName(channelId: string, modelName: string): React.ReactNode {
      return (
        <ModelView
          channelId={channelId}
          model={modelName}
          type="model"
        />
      )
    },

    // ========== 导航方法 ==========

    goToModelManagement(): void {
      window.open(
        `${window.location.origin}${window.location.pathname}#/knowledge?tab=model`,
        '_blank'
      )
    },

    // ========== 公共路径方法 ==========

    getPublicPath(path: string): string {
      return getPublicPath(path)
    },
  }
}

/**
 * 上传图标
 */
async function uploadIcon(icon: string): Promise<string> {
  try {
    const blob = await fetch(icon).then(res => res.blob())
    const res = await uploadApi.upload(new File([blob], 'icon.png', { type: 'image/png' }))
    // 添加空指针保护
    const previewKey = res?.data?.preview_key
    if (!previewKey) {
      console.error('Upload icon failed: no preview_key in response')
      return ''
    }
    return `${api_host}/api/preview/${previewKey}`
  } catch (error) {
    console.error('Upload icon error:', error)
    return ''
  }
}

export default createPipelineAdapter
