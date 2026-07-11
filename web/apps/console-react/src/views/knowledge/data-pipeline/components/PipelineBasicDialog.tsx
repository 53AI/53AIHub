import { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { Modal, Form, Input, Image, message } from 'antd'
import { t } from '@/locales'
import { IconPopover } from '@/components/Icon/popover'
import type { Pipeline } from '../types'
import { createIconFileFromStatic } from '@km/shared-utils'

export interface PipelineBasicDialogRef {
  open: () => void
  close: () => void
}

interface PipelineBasicDialogProps {
  open: boolean
  pipeline?: Pipeline | null
  pipelines?: Pipeline[]
  onCancel: () => void
  onConfirm: (data: { name: string; icon: string }) => void
}

export const PipelineBasicDialog = forwardRef<PipelineBasicDialogRef, PipelineBasicDialogProps>(
  ({ open, pipeline, pipelines, onCancel, onConfirm }, ref) => {
    const [form] = Form.useForm()
    const [submitting, setSubmitting] = useState(false)
    const [icon, setIcon] = useState('')

    const isEdit = useMemo(() => !!pipeline?.id, [pipeline])

    const nameRules = [
      { required: true, message: t('data_pipeline.name_placeholder') },
      { max: 20, message: t('data_pipeline.name_max_length') },
    ]

    // 初始化表单数据
    const initFormData = () => {
      if (pipeline) {
        form.setFieldsValue({ name: pipeline.name || '' })
        setIcon(pipeline.icon || '')
      } else {
        form.setFieldsValue({ name: '' })
        setIcon('')
      }
    }

    // 监听 open 变化，初始化数据
    useEffect(() => {
      if (open) {
        initFormData()
      }
    }, [open, pipeline])

    useImperativeHandle(ref, () => ({
      open: () => {},
      close: () => {},
    }))

    const onIconParams = async (params: { icon: string; bgLight: string; bgDark: string }) => {
      if (params.icon && params.bgLight && params.bgDark) {
        const file = await createIconFileFromStatic(params.icon, params.bgLight, params.bgDark, {
          size: 100,
          iconPadding: 24,
          radius: 10,
        })
        setIcon(URL.createObjectURL(file))
      } else {
        setIcon(params.icon)
      }
    }

    const handleConfirm = async () => {
      try {
        const values = await form.validateFields()
        const trimmedName = values.name.trim()
        if (!trimmedName) {
          message.warning(t('data_pipeline.name_placeholder'))
          return
        }

        // 检测名称是否重复
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

    return (
      <Modal
        open={open}
        title={isEdit ? t('data_pipeline.dialog_title_edit') : t('data_pipeline.dialog_title_create')}
        onCancel={onCancel}
        onOk={handleConfirm}
        okText={t('action_confirm')}
        cancelText={t('action_cancel')}
        confirmLoading={submitting}
        destroyOnHidden
        width={500}
      >
        <Form form={form} layout="vertical">
          {/* Logo和名称区域 */}
          <div className="flex items-start gap-4">
            {/* Logo选择 */}
            <IconPopover
              value={icon}
              showBg={true}
              onIconParams={onIconParams}
            >
              <div
                className="size-[60px] border border-gray-200 rounded-lg flex items-center justify-center shadow-sm cursor-pointer transition-all hover:shadow-md"
              >
                {icon && (
                  <Image
                    className="size-[60px]"
                    src={icon}
                    alt="logo"
                    preview={false}
                    style={{ objectFit: 'contain' }}
                  />
                )}
              </div>
            </IconPopover>

            {/* 名称输入 */}
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

PipelineBasicDialog.displayName = 'PipelineBasicDialog'

export default PipelineBasicDialog
