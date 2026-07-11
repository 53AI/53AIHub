import { Modal, Switch, message } from 'antd'
import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { t } from '@/locales'
import { loadModels } from './index'
import { MODEL_USE_TYPE, type ModelUseType } from '@/constants/platform/config'

export interface ModelOption {
  model_value: string
  value: string
  label: string
  icon: string
}

export interface PlatformItem {
  channel_id: number
  label: string
  icon: string
  options: ModelOption[]
}

export interface ModelDialogProps {
  type?: ModelUseType
  defaultSelected?: string[]
  onConfirm?: (selectedModels: string[]) => void
  onCancel?: () => void
}

export interface ModelDialogRef {
  open: () => void
  close: () => void
}

export const ModelDialog = forwardRef<ModelDialogRef, ModelDialogProps>(
  ({ type = MODEL_USE_TYPE.REASONING, defaultSelected = [], onConfirm, onCancel }, ref) => {
    const [visible, setVisible] = useState(false)
    const [modelList, setModelList] = useState<PlatformItem[]>([])
    const [selectedModels, setSelectedModels] = useState<Record<string, boolean>>({})

    const title = t('model.reasoning')

    // Initialize selected models - matches Vue logic
    const initializeSelectedModels = useCallback(() => {
      const initialSelected: Record<string, boolean> = {}
      modelList.forEach((platform) => {
        platform.options?.forEach((model) => {
          initialSelected[model.model_value] = defaultSelected.includes(model.model_value)
        })
      })
      setSelectedModels(initialSelected)
    }, [modelList, defaultSelected])

    // Load model list
    const loadModelList = async () => {
      try {
        const models = await loadModels(MODEL_USE_TYPE[type] || type)
        setModelList(models)
        // Initialize selected state after loading
        // Note: initializeSelectedModels will be called via useEffect when modelList updates
      } catch (error) {
        console.error('Failed to load models:', error)
        message.error('加载模型列表失败')
      }
    }

    // Open dialog
    const open = useCallback(() => {
      setVisible(true)
      loadModelList()
    }, [type])

    // Close dialog
    const close = useCallback(() => {
      setVisible(false)
    }, [])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      open,
      close,
    }))

    // Initialize selected models when modelList or defaultSelected changes
    useEffect(() => {
      if (modelList.length > 0) {
        initializeSelectedModels()
      }
    }, [modelList, defaultSelected, initializeSelectedModels])

    // Toggle model selection
    const handleToggle = (modelValue: string, isSelected: boolean) => {
      setSelectedModels((prev) => ({
        ...prev,
        [modelValue]: isSelected,
      }))
    }

    // Get selected models
    const getSelectedModels = (): string[] => {
      return Object.keys(selectedModels).filter((key) => selectedModels[key])
    }

    // Handle confirm
    const handleConfirm = () => {
      const selected = getSelectedModels()
      onConfirm?.(selected)
      close()
    }

    // Handle cancel
    const handleCancel = () => {
      onCancel?.()
      close()
    }

    return (
      <Modal
        open={visible}
        title={title}
        onCancel={handleCancel}
        onOk={handleConfirm}
        width={600}
        destroyOnHidden
        mask={{ closable: false }}
        okText={t('action_confirm')}
        cancelText={t('action_cancel')}
      >
        <div className="max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 hover:scrollbar-thumb-gray-400">
          {modelList.map((platform) => (
            <div key={platform.channel_id} className="mb-4 last:mb-0">
              {/* Platform title */}
              <div className="h-9 flex items-center mb-0.5">
                <span className="text-sm font-medium text-secondary">{platform.label}</span>
              </div>

              {/* Model list */}
              <div className="space-y-1">
                {platform.options?.map((model) => (
                  <div key={model.model_value} className="h-8 flex items-center justify-between">
                    <div className="flex items-center flex-1">
                      <img src={model.icon} alt={model.label} className="size-5 mr-2" />
                      <span className="text-sm text-primary">{model.label}</span>
                    </div>
                    <Switch
                      size="small"
                      checked={selectedModels[model.model_value] || false}
                      onChange={(checked) => handleToggle(model.model_value, checked)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    )
  },
)

ModelDialog.displayName = 'ModelDialog'

export default ModelDialog
