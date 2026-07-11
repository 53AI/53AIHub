import { useState, useEffect, useMemo } from 'react'
import { Spin } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { loadModels } from './index'
import './view.css'

interface ModelInfo {
  icon: string
  label: string
  value: string
}

interface ModelViewProps {
  channelId: string | number
  model: string
  showIcon?: boolean
  defaultLabel?: string
}

export function ModelView({
  channelId,
  model,
  showIcon = true,
  defaultLabel = '已删除',
}: ModelViewProps) {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const modelValue = useMemo(() => {
    if (channelId && model) {
      return `${channelId}_53aikm_${model}`
    }
    return ''
  }, [channelId, model])

  const loadModelInfo = async () => {
    if (!channelId || !model) {
      setModelInfo(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const modelList = await loadModels()

      // Find matching model in all channels
      for (const channel of modelList) {
        const matchedOption = channel.options?.find(
          (option: any) => option.value === modelValue
        )

        if (matchedOption) {
          setModelInfo({
            icon: matchedOption.icon,
            label: matchedOption.label,
            value: matchedOption.value,
          })
          return
        }
      }

      // If no exact match, try to match only model name
      for (const channel of modelList) {
        const matchedOption = channel.options?.find((option: any) => {
          const parts = option.value.split('_')
          const modelName = parts[1]
          return modelName === model
        })

        if (matchedOption) {
          setModelInfo({
            icon: matchedOption.icon,
            label: matchedOption.label,
            value: matchedOption.value,
          })
          return
        }
      }

      setModelInfo(null)
    } catch (error) {
      console.error('Failed to load model info:', error)
      setModelInfo(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadModelInfo()
  }, [channelId, model])

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    img.style.display = 'none'
  }

  if (isLoading) {
    return (
      <div className="model-display">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center animate-spin">
            <Spin size="small" />
          </div>
        </div>
      </div>
    )
  }

  if (modelInfo) {
    return (
      <div className="model-display">
        <div className="flex items-center gap-2">
          {modelInfo.icon && showIcon && (
            <img
              src={modelInfo.icon}
              alt={modelInfo.label}
              className="w-5 h-5 object-contain"
              onError={handleImageError}
            />
          )}
          <span className="whitespace-nowrap">{modelInfo.label}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="model-display">
      <div className="flex items-center gap-2">
        {showIcon && (
          <div className="w-5 h-5 bg-gray-200 rounded flex items-center justify-center">
            <QuestionCircleOutlined style={{ fontSize: 12, color: '#999' }} />
          </div>
        )}
        <span className="text-sm text-gray-500 whitespace-nowrap">{defaultLabel}</span>
      </div>
    </div>
  )
}

export default ModelView
