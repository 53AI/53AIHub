import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import recordingApi from '@/api/modules/recording'
import type {
  RecordingCognitionCanonicalType,
  RecordingCognitionLayer,
} from '@/api/modules/recording/types'
import { CANONICAL_TYPE_LABELS } from '../constants'

/** 保存后交回的可编辑字段（scope/layer/domain 未编辑则保持原值，不回传）。 */
export interface SavedCandidateFields {
  id: string | number
  title: string
  statement: string
  cognition_type?: string
}

/** 待确认候选编辑目标：确认前修正 AI 提炼的内容，仅 status=candidate 可编辑。 */
export interface CandidateEditorInit {
  editingId: string | number
  title: string
  statement: string
  cognitionType: RecordingCognitionCanonicalType | ''
  layer: RecordingCognitionLayer
  domainId?: string
  scope?: string[]
}

interface CandidateEditorModalProps {
  open: boolean
  initial: CandidateEditorInit | null
  onClose: () => void
  onSaved: (updated: SavedCandidateFields) => void
}

interface EditorDraft {
  title: string
  statement: string
  cognitionType: RecordingCognitionCanonicalType | ''
  layer: RecordingCognitionLayer
  domainId?: string
  scope?: string[]
}

export function CandidateEditorModal({ open, initial, onClose, onSaved }: CandidateEditorModalProps) {
  const [form] = Form.useForm<EditorDraft>()
  const [saving, setSaving] = useState(false)

  // 打开时按候选内容回填；未分类候选（类型为空）保持空，避免保存时被默认值误分类
  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      title: initial?.title ?? '',
      statement: initial?.statement ?? '',
      cognitionType: initial?.cognitionType ?? '',
      layer: initial?.layer ?? 'core',
      domainId: initial?.domainId ?? undefined,
      scope: initial?.scope ?? [],
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
    if (!initial?.editingId) return
    setSaving(true)
    try {
      const changes: Parameters<typeof recordingApi.updateCognitionCandidate>[1] = {
        title: values.title.trim(),
        statement: values.statement.trim(),
        // 未选择类型则保持原值，不强行分类
        ...(values.cognitionType ? { cognition_type: values.cognitionType } : {}),
        layer: values.layer,
        ...(values.domainId ? { domain_id: values.domainId } : {}),
        ...(values.scope && values.scope.length ? { scope: values.scope } : {}),
      }
      await recordingApi.updateCognitionCandidate(initial.editingId, changes)
      message.success('已保存')
      onClose()
      // 不重新拉取列表：把编辑结果交回列表，由调用方在原地更新对应的候选行
      onSaved({
        id: initial.editingId,
        title: values.title.trim(),
        statement: values.statement.trim(),
        ...(values.cognitionType ? { cognition_type: values.cognitionType } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="编辑待确认认知"
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
            <Select
              placeholder="请选择"
              options={Object.entries(CANONICAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              allowClear
            />
          </Form.Item>
        </div>
        <Form.Item label="描述" name="statement" rules={[{ required: true, whitespace: true, message: '请输入认知表述' }]}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} showCount maxLength={500} placeholder="用自己的话写下希望后续洞察遵循的判断方式" />
        </Form.Item>
        {/* <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Form.Item label="适用层级" name="layer" rules={[{ required: true, message: '请选择适用层级' }]}>
            <Select options={Object.entries(LAYER_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="所属领域（可选）" name="domainId">
            <Select allowClear options={domainOptions} placeholder="跨领域" />
          </Form.Item>
          <Form.Item label="适用范围" name="scope">
            <Select mode="tags" open={false} suffixIcon={null} placeholder="输入后回车添加" />
          </Form.Item>
        </div> */}
      </Form>
    </Modal>
  )
}

export default CandidateEditorModal