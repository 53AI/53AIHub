import { useState, useCallback } from 'react'
import { message, Modal } from 'antd'
import { ragPipelineApi } from '@/api'
import type { Pipeline as ApiPipeline } from '@/api/modules/rag-pipeline'
import type { Pipeline } from './types'
import { createNewPipeline, STEP_KEY_TO_DESCRIPTION, STEP_KEY_TO_NAME } from './constants'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { api_host } from '@/utils/config'
import uploadApi from '@/api/modules/upload'
import { t } from '@/locales'

/**
 * Transform API Pipeline to frontend Pipeline
 */
const transformApiPipelineToFrontend = (apiPipeline: ApiPipeline): Pipeline => {
  const profileJson = typeof apiPipeline.profile_json === 'string'
    ? JSON.parse(apiPipeline.profile_json)
    : apiPipeline.profile_json

  const steps = profileJson.steps.map((step: any) => {
    return {
      ...step,
      name: STEP_KEY_TO_NAME[step.step_key] || step.step_key,
      description: STEP_KEY_TO_DESCRIPTION[step.step_key] || '',
    }
  })
  profileJson.steps = steps

  // Format creation time
  const created_at = apiPipeline.created_time
    ? getSimpleDateFormatString({ date: apiPipeline.created_time, format: 'YYYY-MM-DD hh:mm' })
    : ''

  return {
    id: apiPipeline.id,
    name: apiPipeline.name,
    icon: apiPipeline.icon,
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
      console.error('Failed to fetch pipelines:', error)
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

  const uploadIcon = useCallback(async (icon: string) => {
    try {
      // blob:http://192.168.1.50:8002/52ec9d9d-83e0-4436-984e-7cf488552686
      // Convert to file
      const blob = await fetch(icon).then(res => res.blob())
      const res = await uploadApi.upload(new File([blob], 'icon.png', { type: 'image/png' }))
      return `${api_host}/api/preview/${res.data.preview_key || ''}`
    } catch (error) {
      console.error('Failed to upload icon:', error)
      return ''
    }
  }, [])

  const handleSave = useCallback(async (updatedPipeline: Pipeline) => {
    try {
      const profileJson = updatedPipeline.profile_json
      // If icon is a temporary file, upload to server
      if (updatedPipeline.icon && updatedPipeline.icon.startsWith('blob:')) {
        updatedPipeline.icon = await uploadIcon(updatedPipeline.icon)
      }
      if (updatedPipeline.id && updatedPipeline.id !== '') {
        // Update existing pipeline
        await ragPipelineApi.update(updatedPipeline.id, {
          name: updatedPipeline.name,
          icon: updatedPipeline.icon,
          profile_json: profileJson,
        })
      } else {
        // Create new pipeline
        await ragPipelineApi.create({
          name: updatedPipeline.name,
          icon: updatedPipeline.icon,
          profile_json: profileJson,
        })
      }
      setDetailVisible(false)
      message.success(t('status.save_success'))
      fetchPipelines()
    } catch (error) {
      console.error('Failed to save pipeline:', error)
      setDetailVisible(false)
    }
  }, [uploadIcon, fetchPipelines])

  const handleDelete = useCallback(async (pipeline: Pipeline) => {
    if (!pipeline.id || pipeline.id === '') {
      message.warning('无法删除未保存的流水线')
      return
    }

    Modal.confirm({
      title: t('common.tip'),
      content: `确定要删除流水线"${pipeline.name}"吗？`,
      okText: t('action.confirm'),
      cancelText: t('action.cancel'),
      onOk: async () => {
        await ragPipelineApi.delete(pipeline.id)
        setPipelines(prev => prev.filter(p => p.id !== pipeline.id))
        message.success('已删除')
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

export default usePipeline
