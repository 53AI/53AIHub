import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Form, Input, Button, message } from 'antd'
import { createIconFileFromStatic } from '@km/shared-utils'
import type { Pipeline } from '../types'
import { SetIcon } from '@/views/knowledge/components/SetIcon'
import { t } from '@/locales'
import './PipelineBasicDialog.css'

interface PipelineBasicDialogProps {
  open: boolean
  pipeline?: Pipeline | null
  pipelines?: Pipeline[]
  onClose: () => void
  onConfirm: (data: { name: string; icon: string }) => void
}

export function PipelineBasicDialog({
  open,
  pipeline,
  pipelines,
  onClose,
  onConfirm,
}: PipelineBasicDialogProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    icon: '',
  })

  const isEdit = useMemo(() => !!pipeline?.id, [pipeline?.id])

  // Initialize form data when visible changes
  useEffect(() => {
    if (open) {
      if (pipeline) {
        setFormData({
          name: pipeline.name || '',
          icon: pipeline.icon || '',
        })
      } else {
        setFormData({
          name: '',
          icon: '',
        })
      }
      form.setFieldsValue({
        name: pipeline?.name || '',
      })
    }
  }, [open, pipeline, form])

  const onIconParams = async (params: { icon: string; bgLight: string; bgDark: string }) => {
    if (params.icon && params.bgLight && params.bgDark) {
      const file = await createIconFileFromStatic(params.icon, params.bgLight, params.bgDark, {
        size: 100,
        iconPadding: 24,
        radius: 10,
      })
      setFormData(prev => ({
        ...prev,
        icon: URL.createObjectURL(file),
      }))
    }
  }

  const handleConfirm = async () => {
    try {
      await form.validateFields()
      const trimmedName = formData.name.trim()
      if (!trimmedName) {
        message.warning(t('pipeline.enter_name'))
        return
      }

      // Check for duplicate names
      if (pipelines && pipelines.length > 0) {
        let allNames = pipelines.map(p => p.name.trim())
        if (pipeline?.id) {
          // When editing: check names excluding self
          allNames = pipelines.filter(p => p.id !== pipeline?.id).map(p => p.name.trim())
        }
        if (allNames.includes(trimmedName)) {
          message.warning(t('pipeline.name_exists'))
          return
        }
      }

      setSubmitting(true)
      onConfirm({
        name: trimmedName,
        icon: formData.icon,
      })
      onClose()
    } catch (error) {
      console.error('Validation failed:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? t('action.edit') : t('action.create')}
      onCancel={onClose}
      destroyOnHidden
      mask={{ closable: false }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('action.cancel')}
        </Button>,
        <Button key="confirm" type="primary" loading={submitting} onClick={handleConfirm}>
          {t('action.confirm')}
        </Button>,
      ]}
      width={500}
    >
      <Form form={form} layout="vertical" onSubmitCapture={e => e.preventDefault()}>
        {/* Logo and Name area */}
        <div className="flex items-start gap-4">
          {/* Logo Selection */}
          <SetIcon
            value={formData.icon}
            onChange={val => setFormData(prev => ({ ...prev, icon: val }))}
            onIconParams={onIconParams}
            showBg
            className="size-[60px] border border-gray-200 rounded-lg"
          />

          {/* Name Input */}
          <Form.Item
            className="flex-1 !mb-0"
            label={t('pipeline.name_required')}
            name="name"
            rules={[
              { required: true, message: t('pipeline.enter_name') },
              { max: 20, message: t('pipeline.name_max_length') },
            ]}
          >
            <Input
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder={t('pipeline.enter_name_placeholder')}
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

export default PipelineBasicDialog
