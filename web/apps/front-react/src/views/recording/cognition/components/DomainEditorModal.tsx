import { useEffect, useRef } from 'react'
import { Button, Form, Input, Modal, message } from 'antd'
import { UploadImage } from '@/components/Upload/image'
import recordingApi from '@/api/modules/recording'
import type { RecordingCognitionDomain } from '@/api/modules/recording/types'
import { DEFAULT_DOMAIN_LOGO } from '../constants'
import { useCognitionContext } from './CognitionContext'
import type { DomainCreateDraft } from './types'

interface DomainEditorModalProps {
  open: boolean
  /** null=新建；否则为正在编辑的领域 */
  initial: RecordingCognitionDomain | null
  onClose: () => void
}

export function DomainEditorModal({ open, initial, onClose }: DomainEditorModalProps) {
  const { domainRegistry, refreshAfterMutation } = useCognitionContext()
  const [form] = Form.useForm<DomainCreateDraft>()
  const logoRef = useRef<{ trigger: () => void }>(null)

  // 打开时重置或按编辑目标回填；新建/编辑都保证 logo 展示默认图而非空
  useEffect(() => {
    if (!open) return
    form.resetFields()
    const logo = initial?.logo || ''
    form.setFieldsValue({
      name: initial?.name ?? '',
      description: initial?.description || '',
      logo: logo.startsWith('http') ? logo : DEFAULT_DOMAIN_LOGO,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSave = async () => {
    let values: DomainCreateDraft
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    if (!name) return
    const duplicated = domainRegistry.find(
      (domain) => domain.name === name && (!initial || domain.id !== initial.id)
    )
    if (duplicated) {
      message.warning(`已存在同名领域「${duplicated.name}」，请更换名称`)
      return
    }
    const payload = {
      name,
      description: values.description?.trim() || undefined,
      logo: values.logo?.trim() || DEFAULT_DOMAIN_LOGO,
    }
    if (initial) {
      await recordingApi.updateCognitionDomain(initial.id, payload)
      message.success('已保存')
    } else {
      await recordingApi.createCognitionDomain(payload)
      message.success('已添加')
    }
    onClose()
    // 领域数量计入 overview 的 situational_count，用 refreshAfterMutation 主动重拉计数
    await refreshAfterMutation()
  }

  return (
    <Modal
      title={initial ? '编辑' : '添加'}
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      okText="确认"
      cancelText="取消"
      width={560}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" className="mt-4">
        <div className="flex gap-4">
          {/* 领域图标 */}
          <div className="flex flex-col items-center gap-2">
            <Form.Item name="logo" className="!mb-0">
              <UploadImage ref={logoRef} className="!size-[72px]" />
            </Form.Item>
            <Button
              className="w-[72px] text-xs"
              onClick={() => logoRef.current?.trigger()}
            >
              更换图标
            </Button>
          </div>
          {/* 领域名称 */}
          <div className="flex-1">
            <Form.Item
              name="name"
              required={false}
              rules={[{ required: true, message: '请输入认知名称' }]}
            >
              <Input maxLength={20} showCount placeholder="请输入认知名称" />
            </Form.Item>
            {/* 描述 */}
            <Form.Item name="description">
              <Input.TextArea
                rows={2}
                maxLength={100}
                showCount
                placeholder="请描述关于该认知的描述"
                style={{ resize: 'none' }}
              />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

export default DomainEditorModal