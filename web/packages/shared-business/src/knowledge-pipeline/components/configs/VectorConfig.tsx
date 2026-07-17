import { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Tag, Spin, message } from 'antd'
import { InfoCircleFilled, SettingOutlined, ReloadOutlined, WarningFilled } from '@ant-design/icons'
import { usePipelineTranslation } from '../../context'
import { usePipelineAdapter } from '../../adapters'
import { SvgIcon } from '@km/shared-components-react'

export interface VectorEmbeddingConfig {
  channel_id?: string
  model_name?: string
}

export interface VectorConfigProps {
  config?: Record<string, any>
  onChange?: (config: Record<string, any>) => void
  /** i18n namespace prefix. Defaults to 'data_pipeline' */
  i18nPrefix?: string
}

export function VectorConfig({
  config: _config,
  onChange: _onChange,
  i18nPrefix = 'data_pipeline',
}: VectorConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`
  const adapter = usePipelineAdapter()

  const [isLoading, setIsLoading] = useState(false)
  const [vectorEmbedding, setVectorEmbedding] = useState<VectorEmbeddingConfig | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const initializedRef = useRef(false)

  const loadTestResult = useCallback(async () => {
    if (!vectorEmbedding?.channel_id || !vectorEmbedding?.model_name || !adapter?.testVectorModel) {
      return
    }
    try {
      const result = await adapter.testVectorModel(vectorEmbedding.channel_id, vectorEmbedding.model_name)
      setTestResult(result)
    } catch (err) {
      console.error('Failed to test vector embedding:', err)
      setTestResult(null)
    }
  }, [vectorEmbedding, adapter])

  const loadVectorEmbedding = useCallback(async () => {
    if (!adapter?.getVectorEmbedding) return

    setIsLoading(true)
    try {
      const data = await adapter.getVectorEmbedding()
      setVectorEmbedding(data)
      if (data?.channel_id && data?.model_name) {
        await loadTestResult()
      }
    } catch (error) {
      console.error('Failed to load vector embedding config:', error)
    } finally {
      setIsLoading(false)
    }
  }, [adapter, loadTestResult])

  const handleRefresh = useCallback(async () => {
    if (!adapter?.getVectorEmbedding) return

    setIsLoading(true)
    try {
      const data = await adapter.getVectorEmbedding()
      setVectorEmbedding(data)
      if (data?.channel_id && data?.model_name) {
        await loadTestResult()
      }
      message.success(t(tKey('vector_refresh_success')))
    } catch (error) {
      console.error('Failed to refresh vector embedding config:', error)
    } finally {
      setIsLoading(false)
    }
  }, [adapter, loadTestResult, t, tKey])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (adapter?.getVectorEmbedding) {
      loadVectorEmbedding()
    }
  }, [adapter, loadVectorEmbedding])

  const hasVectorConfig = vectorEmbedding?.channel_id && vectorEmbedding?.model_name

  const handleGoToModelManagement = () => {
    adapter?.goToModelManagement?.()
  }

  // 使用适配器提供的渲染器或默认渲染
  const renderModelIcon = () => {
    if (adapter?.renderModelIcon && vectorEmbedding?.channel_id && vectorEmbedding?.model_name) {
      return adapter.renderModelIcon(vectorEmbedding.channel_id, vectorEmbedding.model_name)
    }
    return <SvgIcon name="model" size={40} />
  }

  const renderProviderName = () => {
    if (adapter?.renderProviderName && vectorEmbedding?.channel_id && vectorEmbedding?.model_name) {
      return adapter.renderProviderName(vectorEmbedding.channel_id, vectorEmbedding.model_name)
    }
    return t(tKey('vector_model_provider'))
  }

  const renderModelName = () => {
    if (adapter?.renderModelName && vectorEmbedding?.channel_id && vectorEmbedding?.model_name) {
      return adapter.renderModelName(vectorEmbedding.channel_id, vectorEmbedding.model_name)
    }
    return vectorEmbedding?.model_name || ''
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="bg-[#F5F8FF] p-4 rounded-xl flex items-start gap-3">
        <InfoCircleFilled className="text-blue-600 mt-0.5" style={{ fontSize: 18 }} />
        <div className="flex-1">
          <div className="flex justify-between items-center">
            <div className="text-base font-bold text-gray-800">
              {t(tKey('vector_global_embedding'))}
            </div>
            <Button type="link" loading={isLoading} onClick={handleRefresh}>
              <ReloadOutlined />
              <span className="ml-1">{t(tKey('vector_refresh_config'))}</span>
            </Button>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            {t(tKey('vector_embedding_tip'))}
          </p>
        </div>
      </div>

      <div className="border border-[#2563EB] rounded-xl p-5 bg-white shadow-sm relative overflow-hidden group">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Spin />
          </div>
        ) : hasVectorConfig ? (
          <div className="flex items-center gap-3 relative z-10">
            <div className="size-[50px] rounded-lg bg-blue-50 flex items-center justify-center shadow-sm">
              {renderModelIcon()}
            </div>
            <div className="flex-1 flex items-center gap-3">
              {/* 正常状态 */}
              {(!testResult || testResult.success) && (
                <div className="flex-1">
                  <span className="font-bold text-sm text-gray-400">
                    {renderProviderName()}
                  </span>
                  <div className="text-sm text-gray-800 mt-1 font-medium">
                    {renderModelName()}
                  </div>
                </div>
              )}

              {/* 异常状态 */}
              {testResult && !testResult.success && (
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-red-500">
                    <WarningFilled />
                    <span className="font-medium">{t(tKey('vector_model_error'))}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2">
                    {testResult.message || t(tKey('vector_check_config'))}
                  </div>
                </div>
              )}

              {testResult && (
                <Tag color={testResult.success ? 'success' : 'error'}>
                  {testResult.success ? t(tKey('vector_available')) : t(tKey('vector_unavailable'))}
                </Tag>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-gray-400">
            {t(tKey('vector_no_config'))}
          </div>
        )}
      </div>

      {adapter?.goToModelManagement && (
        <div className="pt-4 flex justify-center">
          <div
            className="flex items-center gap-2 px-2 py-1 rounded text-sm text-gray-500 cursor-pointer hover:bg-blue-50 hover:text-blue-600 transition-all border border-transparent hover:border-blue-100"
            onClick={handleGoToModelManagement}
          >
            <SettingOutlined style={{ color: '#545454' }} />
            <span>{t(tKey('vector_go_model_setting'))}</span>
            <SvgIcon name="jump" size={14} />
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorConfig
