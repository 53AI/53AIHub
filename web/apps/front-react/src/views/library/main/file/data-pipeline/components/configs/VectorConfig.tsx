import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button, Tag, Spin, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { SvgIcon } from '@km/shared-components-react'
import chunkSettingApi from '@/api/modules/chunk-setting'
import channelApi from '@/api/modules/channel/index'
import type { ModelSetting } from '@/api/modules/chunk-setting'
import { ModelView } from '@/components/Model/view'
import { t } from '@/locales'
import { getBasePath } from '@/router'
import './VectorConfig.css'

interface VectorConfigProps {
  config: any
  onChange?: (config: any) => void
}

export function VectorConfig({ config, onChange }: VectorConfigProps) {
  const location = useLocation()
  const [isLoading, setIsLoading] = useState(false)
  const [vectorEmbedding, setVectorEmbedding] = useState<ModelSetting['model_config']['vector_embedding'] | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // Track if initial load is done
  const initializedRef = useRef(false)

  const vectorValue = useMemo(() => {
    return vectorEmbedding?.channel_id && vectorEmbedding?.model_name
      ? `${vectorEmbedding.channel_id}_53aikm_${vectorEmbedding.model_name}`
      : ''
  }, [vectorEmbedding])

  const loadTestResult = useCallback(() => {
    if (!vectorEmbedding?.channel_id || !vectorEmbedding?.model_name) {
      return
    }
    channelApi
      .test(vectorEmbedding.channel_id, {
        model: vectorEmbedding.model_name,
      })
      .then(res => {
        setTestResult(res)
      })
      .catch(err => {
        console.error('Failed to test vector embedding:', err)
        setTestResult(null)
      })
  }, [vectorEmbedding])

  // Load vector embedding configuration
  const loadVectorEmbedding = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await chunkSettingApi.modelConfig.get()
      setVectorEmbedding(data.model_config.vector_embedding)
      loadTestResult()
    } catch (error) {
      console.error('Failed to load vector embedding config:', error)
      setVectorEmbedding(null)
    } finally {
      setIsLoading(false)
    }
  }, [loadTestResult])

  const handleRefresh = () => {
    loadVectorEmbedding().finally(() => {
      message.success('刷新成功')
    })
  }

  const handleGoToModelManagement = () => {
    // 兼容 HashRouter 和 BrowserRouter 模式
    const basePath = getBasePath()
    const path = basePath ? `${basePath}/#/knowledge?tab=model` : '/knowledge?tab=model'
    window.open(`${window.location.origin}${path}`, '_blank')
  }

  // Only load once on mount
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    loadVectorEmbedding()
  }, [loadVectorEmbedding])

  return (
    <div className="vector-config-container space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="bg-[#F5F8FF] p-4 rounded-xl flex items-start gap-3">
        <SvgIcon name="info" className="text-[#2563EB] mt-0.5" size={18} />
        <div className="flex-1">
          <div className="flex justify-between items-center">
            <div className="text-base font-bold text-[#1D1E1F]">系统嵌入模型（全局）</div>
            <Button
              type="link"
              loading={isLoading}
              onClick={handleRefresh}
              icon={<SvgIcon name="refresh" />}
            >
              刷新配置
            </Button>
          </div>
          <p className="text-sm text-[#999999] mt-1">
            此流水线使用知识库全局配置的 Embedding
            模型，以确保全量数据兼容。如果需要更改模型，请前往系统接入设置。注意：更改后将触发该空间内所有文档的重新索引。
          </p>
        </div>
      </div>

      <Spin spinning={isLoading}>
        <div className="border border-[#2563EB] rounded-xl p-5 bg-white shadow-sm relative overflow-hidden group">
          {vectorValue && (
            <div className="flex items-center gap-3 relative z-10">
              <div className="size-[50px] rounded-lg bg-blue-50 flex items-center justify-center shadow-sm">
                <ModelView
                  channelId={vectorEmbedding?.channel_id ?? ''}
                  model={vectorEmbedding?.model_name ?? ''}
                  showIcon={true}
                />
              </div>
              <div className="flex-1 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm text-[#1D1E1F] mt-1 font-medium">
                    <ModelView
                      channelId={vectorEmbedding?.channel_id ?? ''}
                      model={vectorEmbedding?.model_name ?? ''}
                      showIcon={false}
                    />
                  </div>
                </div>

                {testResult && (
                  <Tag color={testResult.success ? 'success' : 'error'}>
                    {testResult.success ? '可用' : '不可用'}
                  </Tag>
                )}
              </div>
            </div>
          )}

          {!vectorValue && !isLoading && (
            <div className="text-center py-4 text-gray-400">
              未配置嵌入模型
            </div>
          )}
        </div>
      </Spin>

      <div className="pt-4 flex justify-center">
        <div
          className="flex items-center gap-2 px-2 py-1 rounded text-sm text-[#545454] cursor-pointer hover:bg-blue-50 hover:text-[#2563EB] transition-all border border-transparent hover:border-blue-100"
          onClick={handleGoToModelManagement}
        >
          <SvgIcon name="settings" className="text-[#545454]" />
          <span>去 "后台 - 知识库 - 模型设置" 管理全局配置</span>
          <SvgIcon name="jump" size={14} />
        </div>
      </div>
    </div>
  )
}

export default VectorConfig
