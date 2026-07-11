import { useState, useRef, forwardRef, useImperativeHandle, FormEvent } from 'react'
import { Modal, Form, Input, Button } from 'antd'
import type { FormInstance } from 'antd'

interface UIDialogRef {
  open: (data: { title?: string; label?: string; content?: string }) => void
}

interface UIDialogProps {
  onConfirm?: (data: { content: string }) => void
  onCancel?: () => void
}

export const UIDialog = forwardRef<UIDialogRef, UIDialogProps>(
  ({ onConfirm, onCancel }, ref) => {
    const [visible, setVisible] = useState(false)
    const [title, setTitle] = useState('')
    const [label, setLabel] = useState('')
    const [content, setContent] = useState('')
    const [form] = Form.useForm()

    const open = (data: { title?: string; label?: string; content?: string }) => {
      setTitle(data.title || '')
      setLabel(data.label || '')
      setContent(data.content || '')
      form.setFieldsValue({ content: data.content || '' })
      setVisible(true)
    }

    const handleCancel = () => {
      setVisible(false)
      onCancel?.()
    }

    const handleConfirm = () => {
      form.validateFields().then((values) => {
        onConfirm?.({ content: values.content.trim() })
        setVisible(false)
      })
    }

    useImperativeHandle(ref, () => ({
      open,
    }))

    const validateContent = (_: unknown, value: string) => {
      const trimmedValue = value?.trim()
      if (!trimmedValue) {
        return Promise.reject(new Error(`请输入${label}`))
      }
      if (trimmedValue.includes('/')) {
        return Promise.reject(new Error(`${label}不能包含斜杠`))
      }
      if (/^[^\w\u4e00-\u9fa5]+$/.test(trimmedValue)) {
        return Promise.reject(new Error(`${label}不能只有特殊符号`))
      }
      return Promise.resolve()
    }

    return (
      <Modal
        open={visible}
        title={title}
        onCancel={handleCancel}
        footer={null}
        mask={{ closable: false }}
        keyboard={false}
        width={600}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleConfirm}
          requiredMark="optional"
        >
          <Form.Item
            label={label}
            name="content"
            rules={[
              { required: true, message: `请输入${label}` },
              { validator: validateContent },
            ]}
          >
            <Input
              placeholder={`请输入${label}`}
              onChange={(e) => setContent(e.target.value.trim())}
            />
          </Form.Item>
          <div className="flex justify-end gap-2 mt-4">
            <Button onClick={handleCancel}>取消</Button>
            <Button type="primary" onClick={handleConfirm}>
              保存
            </Button>
          </div>
        </Form>
      </Modal>
    )
  }
)

export default UIDialog
