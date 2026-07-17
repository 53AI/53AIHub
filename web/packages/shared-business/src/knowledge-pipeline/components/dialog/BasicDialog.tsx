import { useState, useEffect, useMemo, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { Modal, Form, Input, message } from 'antd'
import { usePipelineTranslation } from '../../context'
import type { Pipeline } from '../../types'

export interface BasicDialogRef {
  open: () => void
  close: () => void
}

export interface BasicDialogProps {
  open: boolean
  pipeline?: Pipeline | null
  pipelines?: Pipeline[]
  onCancel: () => void
  onConfirm: (data: { name: string; icon: string }) => void
  /** Custom icon picker component. If not provided, renders icon preview only */
  iconPicker?: (props: {
    value: string
    onChange: (value: string) => void
    children: ReactNode
  }) => ReactNode
}

export const BasicDialog = forwardRef<BasicDialogRef, BasicDialogProps>(
  ({ open, pipeline, pipelines, onCancel, onConfirm, iconPicker: IconPicker }, ref) => {
    const { t } = usePipelineTranslation()
    const [form] = Form.useForm()
    const [submitting, setSubmitting] = useState(false)
    const [icon, setIcon] = useState('')

    const isEdit = useMemo(() => !!pipeline?.id, [pipeline])

    const nameRules = [
      { required: true, message: t('data_pipeline.name_placeholder') },
      { max: 20, message: t('data_pipeline.name_max_length') },
    ]

    const initFormData = () => {
      if (pipeline) {
        form.setFieldsValue({ name: pipeline.name || '' })
        setIcon(pipeline.icon || '')
      } else {
        form.setFieldsValue({ name: '' })
        setIcon('')
      }
    }

    useEffect(() => {
      if (open) {
        initFormData()
      }
    }, [open, pipeline])

    useImperativeHandle(ref, () => ({
      open: () => {},
      close: () => {},
    }))

    const handleConfirm = async () => {
      try {
        const values = await form.validateFields()
        const trimmedName = values.name.trim()
        if (!trimmedName) {
          message.warning(t('data_pipeline.name_placeholder'))
          return
        }

        // Check for duplicate names
        if (pipelines && pipelines.length > 0) {
          let allNames = pipelines.map(p => p.name.trim())
          if (pipeline?.id) {
            allNames = pipelines.filter(p => p.id !== pipeline?.id).map(p => p.name.trim())
          }
          if (allNames.includes(trimmedName)) {
            message.warning(t('data_pipeline.name_duplicate'))
            return
          }
        }

        setSubmitting(true)
        onConfirm({ name: trimmedName, icon })
        setSubmitting(false)
      } catch (error) {
        console.error('Validation failed:', error)
      }
    }

    const iconPreview = (
      <div className="size-[60px] border border-gray-200 rounded-lg flex items-center justify-center shadow-sm cursor-pointer transition-all hover:shadow-md">
        {icon && (
          <img
            className="size-[60px] object-contain"
            src={icon}
            alt="logo"
          />
        )}
      </div>
    )

    return (
      <Modal
        open={open}
        title={isEdit ? t('data_pipeline.dialog_title_edit') : t('data_pipeline.dialog_title_create')}
        onCancel={onCancel}
        onOk={handleConfirm}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
        confirmLoading={submitting}
        destroyOnHidden
        width={500}
      >
        <Form form={form} layout="vertical">
          <div className="flex items-start gap-4">
            {/* Logo Selection */}
            {IconPicker ? (
              IconPicker({ value: icon, onChange: setIcon, children: iconPreview })
            ) : (
              iconPreview
            )}

            {/* Name Input */}
            <Form.Item
              className="flex-1 !mb-0"
              label={t('data_pipeline.name_label')}
              name="name"
              rules={nameRules}
            >
              <Input
                placeholder={t('data_pipeline.name_placeholder')}
                maxLength={20}
                showCount
                onPressEnter={handleConfirm}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    )
  }
)

BasicDialog.displayName = 'BasicDialog'

export default BasicDialog
