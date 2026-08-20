import { useState, forwardRef, useImperativeHandle, useMemo } from 'react'
import { Modal, Form, Input, Button, message } from 'antd'
import { t } from '@/locales'
import { useChannelStore } from '@/stores'
import { clearModelCache } from '@/components/Model'
import { MODEL_USE_TYPE } from '@/constants/platform/config'

interface ModelData {
  id?: string
  value?: string
  label?: string
  icon?: string
  models?: string[]
  config?: {}
  channel_id?: string
  key?: string
  base_url?: string
  type?: string
  other?: string
  name?: string
  organization_id?: string
  channel_type?: number
  modelType?: string
  custom_config?: {
    alias_map?: Record<string, string>
    deep_thinking?: string[]
    vision?: string[]
    voice_models?: Record<string, { workspace_id?: string; display_name?: string }>
  }
}

interface ModelSettingDialogProps {
  onSuccess: (result: { action: 'model_edit'; data: { id: string; name: string } }) => void
}

export interface ModelSettingDialogRef {
  open: (options?: { data?: ModelData }) => void
  close: () => void
}

export const ModelSettingDialog = forwardRef<ModelSettingDialogRef, ModelSettingDialogProps>(
  ({ onSuccess }, ref) => {
    const [form] = Form.useForm()
    const [visible, setVisible] = useState(false)
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [originData, setOriginData] = useState<ModelData>({})

    const channelStore = useChannelStore()

    const isVoiceModel = useMemo(() => {
      const modelType = originData.modelType || originData.type
      return String(modelType) === String(MODEL_USE_TYPE.VOICE)
    }, [originData])

    const open = async (options: { data?: ModelData } = {}) => {
      const { data = {} as ModelData } = options
      const modelId = data.id || data.value || ''
      const voiceConfig = data.custom_config?.voice_models?.[modelId]
      form.setFieldsValue({
        id: modelId,
        name: data.label || data.name || '',
        workspace_id: voiceConfig?.workspace_id || '',
      })
      setOriginData(data)
      setVisible(true)
    }

    const close = () => {
      setVisible(false)
    }

    const onSave = async () => {
      try {
        const values = await form.validateFields()
        setSubmitting(true)

        const { id = '', name = '' } = values
        const channel_type = originData.channel_type

        const custom_config: Record<string, any> = { ...(originData.custom_config || {}) }
        custom_config.alias_map = {
          ...(custom_config.alias_map || {}),
          [id]: name.trim(),
        }
        if (!custom_config.alias_map[id]) delete custom_config.alias_map[id]
        if (!Object.keys(custom_config.alias_map).length) delete custom_config.alias_map

        // 语音模型：更新 voice_models 中的 display_name 与 api_domain
        if (isVoiceModel) {
          custom_config.voice_models = {
            ...(custom_config.voice_models || {}),
            [id]: {
              ...(custom_config.voice_models?.[id] || {}),
              display_name: id,
              api_domain: originData.base_url || '',
            },
          }
        }

        const data = {
          channel_id: originData.channel_id,
          config: JSON.stringify(originData.config || {}),
          key: originData.key,
          base_url: originData.base_url,
          models: originData.models,
          name: originData.name,
          other: originData.other,
          type: channel_type,
          custom_config: JSON.stringify(custom_config),
        }

        await channelStore.save({ data })
        clearModelCache()
        message.success(t('action_save_success'))
        onSuccess({ action: 'model_edit', data: { id, name: name || id } })
        close()
      } catch (error) {
        console.error('Save model setting error:', error)
      } finally {
        setSubmitting(false)
      }
    }

    useImperativeHandle(ref, () => ({
      open,
      close,
    }), [])

    return (
      <Modal
        open={visible}
        title={t('module.platform_model_models_edit')}
        onCancel={close}
        width={600}
        destroyOnHidden
        mask={{ closable: false }}
        getContainer={false}
        footer={
          <>
            <Button
              className="text-primary"
              onClick={close}
            >
              {t('action_cancel')}
            </Button>
            <Button
              type="primary"
              loading={submitting || loading}
              onClick={onSave}
            >
              {t('action_save')}
            </Button>
          </>
        }
      >
        <Form form={form} layout="vertical">
          {isVoiceModel && (
            <Form.Item
              label="Workspace ID"
              name="workspace_id"
            >
              <Input disabled placeholder={t('form_input_placeholder')} />
            </Form.Item>
          )}
          <Form.Item
            label={t('module.platform_model_models_id')}
            name="id"
            rules={[{ required: true, message: t('form_input_placeholder') }]}
          >
            <Input disabled placeholder={t('form_input_placeholder')} />
          </Form.Item>
          <Form.Item
            label={
              isVoiceModel
                ? t('module.platform_model_display_name')
                : t('module.platform_model_models_name')
            }
            name="name"
          >
            <Input
              placeholder={
                isVoiceModel
                  ? t('module.platform_model_display_name_placeholder')
                  : t('form_input_placeholder')
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    )
  }
)

export default ModelSettingDialog
