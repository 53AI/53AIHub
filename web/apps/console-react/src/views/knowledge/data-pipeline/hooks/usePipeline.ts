import { useState, useCallback } from 'react'
import { message, Modal } from 'antd'
import { ragPipelineApi } from '@/api/modules/rag-pipeline'
import type { Pipeline as ApiPipeline } from '@/api/modules/rag-pipeline'
import type { Pipeline } from '../types'
import { createNewPipeline, STEP_KEY_TO_DESCRIPTION, STEP_KEY_TO_NAME } from '../constants'
import { uploadApi } from '@/api/modules/upload'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { api_host } from '@/utils/config'
import { t } from '@/locales'

/**
 * 将 API Pipeline 转换为前端 Pipeline
 */
const transformApiPipelineToFrontend = (apiPipeline: ApiPipeline): Pipeline => {
  const profileJson = apiPipeline.profile_json
  const steps = profileJson.steps.map((step: any) => {
    return {
      ...step,
      name: STEP_KEY_TO_NAME[step.step_key] || step.step_key,
      description: STEP_KEY_TO_DESCRIPTION[step.step_key] || '',
    }
  })
  profileJson.steps = steps

  // 格式化创建时间
  const created_at = apiPipeline.created_time
    ? getSimpleDateFormatString({ date: apiPipeline.created_time, format: 'YYYY-MM-DD hh:mm' })
    : ''

  return {
    id: apiPipeline.id,
    name: apiPipeline.name,
    icon: apiPipeline.icon || (api_host + '/api/images/library/pipeline-icon.png.png'),
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

export const usePipeline = () => {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [detailVisible, setDetailVisible] = useState(false)
  const [currentPipeline, setCurrentPipeline] = useState<Pipeline | null>(null)

  const fetchPipelines = useCallback(async () => {
    setIsLoading(true)
    try {
      const apiPipelines = await ragPipelineApi.getList()
      setPipelines(apiPipelines.map(transformApiPipelineToFrontend))
    } catch (error) {
      console.error('Fetch pipelines error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleEdit = useCallback((pipeline: Pipeline) => {
    setCurrentPipeline(JSON.parse(JSON.stringify(pipeline)))
    setDetailVisible(true)
  }, [])

  const handleAdd = useCallback(() => {
    const newPipeline = createNewPipeline()
    setCurrentPipeline(newPipeline)
    return newPipeline
  }, [])

  const uploadIcon = useCallback(async (icon: string): Promise<string> => {
    try {
      const blob = await fetch(icon).then(res => res.blob())
      const res = await uploadApi.upload(new File([blob], 'icon.png', { type: 'image/png' }))
      return `${api_host}/api/preview/${res.data.preview_key || ''}`
    } catch (error) {
      console.error('Upload icon error:', error)
      return ''
    }
  }, [])

  const handleSave = useCallback(async (updatedPipeline: Pipeline) => {
    try {
      const profileJson = updatedPipeline.profile_json
      // 如果icon是临时文件，则上传到服务器
      if (updatedPipeline.icon && updatedPipeline.icon.startsWith('blob:')) {
        updatedPipeline.icon = await uploadIcon(updatedPipeline.icon)
      }
      if (updatedPipeline.id && updatedPipeline.id !== '') {
        // 更新现有流水线
        await ragPipelineApi.update(updatedPipeline.id, {
          name: updatedPipeline.name,
          icon: updatedPipeline.icon,
          profile_json: profileJson,
        })
      } else {
        // 创建新流水线
        await ragPipelineApi.create({
          name: updatedPipeline.name,
          icon: updatedPipeline.icon,
          profile_json: profileJson,
        })
      }
      setDetailVisible(false)
      message.success(t('message_status.save_success'))
      fetchPipelines()
    } catch (error) {
      console.error('Save pipeline error:', error)
      setDetailVisible(false)
    }
  }, [fetchPipelines, uploadIcon])

  const handleDelete = useCallback(async (pipeline: Pipeline) => {
    if (!pipeline.id || pipeline.id === '') {
      message.warning(t('data_pipeline.cannot_delete_unsaved'))
      return
    }

    Modal.confirm({
      title: t('tip'),
      content: t('data_pipeline.delete_confirm', { name: pipeline.name }),
      okText: t('action_confirm'),
      cancelText: t('action_cancel'),
      onOk: async () => {
        await ragPipelineApi.delete(pipeline.id)
        setPipelines(prev => prev.filter(p => p.id !== pipeline.id))
        message.success(t('data_pipeline.deleted_success'))
      },
    })
  }, [])

  return {
    pipelines,
    isLoading,
    detailVisible,
    currentPipeline,
    fetchPipelines,
    handleEdit,
    handleAdd,
    handleSave,
    handleDelete,
    setDetailVisible,
    setCurrentPipeline,
  }
}
