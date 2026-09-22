import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import recordingApi from '@/api/modules/recording'
import type {
  RecordingCognitionCanonicalType,
  RecordingCognitionLayer,
  RecordingCognitionDetail,
} from '@/api/modules/recording/types'
import { CANONICAL_TYPE_LABELS, LAYER_LABELS } from '../constants'
import { useCognitionContext } from './CognitionContext'
import type { EditorDraft } from './types'

/** 编辑/新建目标：editingId 有值=编辑现有认知；否则=新建（可携带抽屉作用域预置的 layer/domainId） */
export interface CognitionEditorInit {
  editingId?: string | number
  title: string
  statement: string
  cognitionType: RecordingCognitionCanonicalType | ''
  layer: RecordingCognitionLayer
  domainId?: string
}

interface CognitionEditorModalProps {
  open: boolean
  initial: CognitionEditorInit | null
  onClose: () => void
  /** 保存成功后的回调，交回保存结果（原地更新列表或刷新计数由调用方决定） */
  onSaved?: (detail: RecordingCognitionDetail) => void
}

export function CognitionEditorModal({ open, initial, onClose, onSaved }: CognitionEditorModalProps) {
  const { domainRegistry } = useCognitionContext()
  const [form] = Form.useForm<EditorDraft>()
  const [saving, setSaving] = useState(false)

  // 打开时按目标回填：新建用默认值，编辑用现有字段
  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      title: initial?.title ?? '',
      statement: initial?.statement ?? '',
      cognitionType: initial?.cognitionType ?? 'principle',
      layer: initial?.layer ?? 'core',
      domainId: initial?.domainId ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSave = async () => {
    let values: EditorDraft
    try {
      values = await form.validateFields()
    } catch {
      return // 校验失败：Form 已在字段下展示错误提示
    }
    if (!values.cognitionType) {
      message.warning('请选择认知类型；历史待重分类记录不能直接猜测类型')
      return
    }
    setSaving(true)
    try {
      let saved: RecordingCognitionDetail
      if (initial?.editingId != null) {
        saved = await recordingApi.updateCognition(initial.editingId, {
          title: values.title.trim(),
          statement: values.statement.trim(),
          cognition_type: values.cognitionType,
        })
      } else {
        saved = await recordingApi.createCognition({
          title: values.title.trim(),
          statement: values.statement.trim(),
          cognition_type: values.cognitionType,
          layer: values.layer,
          domain_id: values.domainId || undefined,
          source_type: 'boss_authored',
          confidence: 1,
        })
      }
      message.success('已保存')
      onClose()
      onSaved?.(saved)
    } finally {
      setSaving(false)
    }
  }

  const layer = Form.useWatch('layer', form)
  const isCore = layer === 'core'
  const editing = initial?.editingId != null
  const domainOptions = domainRegistry.map((domain) => ({ value: domain.id, label: domain.name }))
  return (
    <Modal
      title={editing ? '编辑认知' : '添加认知'}
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnHidden
      width={600}
      zIndex={2000}
    >

      <Form
        form={form}
        layout="vertical"
        requiredMark={(label, info) => (
          <>
            {label}
            {info.required && <span className="ml-0.5 text-[#ff4d4f]">*</span>}
          </>
        )}
      >
        <div className="flex items-center gap-4">
          <Form.Item className="flex-1" label="认知" name="title" rules={[{ required: true, whitespace: true, message: '请输入认知标题' }]}>
            <Input placeholder="例如：现金流优先于规模扩张" showCount maxLength={50} />
          </Form.Item>
          <Form.Item className="flex-1" label="类型" name="cognitionType">
            <Select disabled={isCore} placeholder="请选择" options={Object.entries(CANONICAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </div>
        <Form.Item label="描述" name="statement" rules={[{ required: true, whitespace: true, message: '请输入认知表述' }]}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} showCount maxLength={500} placeholder="用自己的话写下希望后续洞察遵循的判断方式" />
        </Form.Item>
        <div className="hidden">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Form.Item label="适用层级" name="layer" rules={[{ required: true, message: '请选择适用层级' }]}>
              <Select options={Object.entries(LAYER_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item label="所属领域（可选）" name="domainId">
              <Select allowClear options={domainOptions} placeholder="跨领域" />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

export default CognitionEditorModal