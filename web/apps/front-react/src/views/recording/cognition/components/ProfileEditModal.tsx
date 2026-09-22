import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import memoryApi from '@/api/modules/memory'
import { useUserStore } from '@/stores/modules/user'

export type ProfileEditDraft = {
  nickname: string
  department: string
  position: string
  style: string
  customMemory: string
}

interface ProfileEditModalProps {
  open: boolean
  /** 打开时回填的初始值（由父级从 profileInfo 构造；新建为空字符串） */
  initial: ProfileEditDraft | null
  onClose: () => void
  /** 保存成功后由父级刷新个人信息 */
  onSaved: () => void
}

export function ProfileEditModal({ open, initial, onClose, onSaved }: ProfileEditModalProps) {
  const [form] = Form.useForm<ProfileEditDraft>()
  const [saving, setSaving] = useState(false)
  const userStore = useUserStore()

  // 打开时回填初始值
  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      nickname: initial?.nickname ?? '',
      department: initial?.department ?? '',
      position: initial?.position ?? '',
      style: initial?.style ?? '',
      customMemory: initial?.customMemory ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSave = async () => {
    let values: ProfileEditDraft
    try {
      values = await form.validateFields()
    } catch {
      return // 校验失败：Form 已在字段下展示错误提示
    }
    setSaving(true)
    try {
      // 昵称走账号接口（userStore.update），职位/风格/个性要求走认知画像接口
      const name = values.nickname.trim()
      if (name) await userStore.update({ nickname: name })
      await memoryApi.user.replace({
        position: values.position,
        style: values.style,
        custom_memory: values.customMemory,
      })
      message.success('已保存')
      onClose()
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="个人信息"
      open={open}
      onCancel={onClose}
      onOk={() => void handleSave()}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={800}
    >
      <Form form={form} layout="vertical" className="mt-4">
        <div className="flex gap-4">
          <Form.Item
            label="昵称"
            name="nickname"
            className="flex-1"
            rules={[{ required: true, whitespace: true, message: '请输入昵称' }]}
          >
            <Input maxLength={30} showCount placeholder="请输入昵称" />
          </Form.Item>
          <Form.Item label="部门" name="department" className="flex-1">
            <Input disabled className="bg-[#F5F5F5]" />
          </Form.Item>
        </div>
        <div className="flex gap-4">
          <Form.Item label="职位" name="position" className="flex-1">
            <Input maxLength={15} showCount placeholder="请输入职位" />
          </Form.Item>
          <Form.Item label="期望风格" name="style" className="flex-1">
            <Select
              placeholder="请选择期望风格"
              allowClear
              options={[
                { value: '内容简洁、突出结论', label: '内容简洁、突出结论' },
                { value: '结论先行、细节支撑', label: '结论先行、细节支撑' },
                { value: '详细分析、引发思考', label: '详细分析、引发思考' },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item label="个性要求" name="customMemory">
          <Input.TextArea
            rows={4}
            placeholder="请输入自定义指令，如：简洁直接。除非我另行说明，默认使用 Python。编写文档时，以专业语气书写并引用来源。"
            style={{ resize: 'none' }}
            className="resize-none"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ProfileEditModal