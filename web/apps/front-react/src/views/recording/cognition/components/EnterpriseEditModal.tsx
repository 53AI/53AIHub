import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, message } from 'antd'
import enterpriseApi from '@/api/modules/enterprise'
import { useEnterpriseStore } from '@/stores/modules/enterprise'

export type EnterpriseEditDraft = {
  displayName: string
  fullName: string
  industry: string
  description: string
}

// 行业选项：值与 console 后台 select 一致（中文存后端 industry 字段）
const INDUSTRY_OPTIONS = [
  '农、林、牧、渔业',
  '采矿业',
  '制造业',
  '电力、热力、燃气及水生产和供应业',
  '建筑业',
  '批发和零售业',
  '交通运输、仓储和邮政业',
  '住宿和餐饮业',
  '信息传输、软件和信息技术服务业',
  '金融业',
  '房地产业',
  '租赁和商务服务业',
  '科学研究和技术服务业',
  '水利、环境和公共设施管理业',
  '居民服务、修理和其他服务业',
  '教育',
  '卫生和社会工作',
  '文化、体育和娱乐业',
  '公共管理、社会保障和社会组织',
  '国际组织',
]

interface EnterpriseEditModalProps {
  open: boolean
  onClose: () => void
}

export function EnterpriseEditModal({ open, onClose }: EnterpriseEditModalProps) {
  const enterpriseStore = useEnterpriseStore()
  const [form] = Form.useForm<EnterpriseEditDraft>()
  const [saving, setSaving] = useState(false)

  // 打开时从全局企业 store 回填
  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      displayName: enterpriseStore.display_name || '',
      fullName: enterpriseStore.full_name || '',
      industry: enterpriseStore.industry || '',
      description: enterpriseStore.description || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSave = async () => {
    let values: EnterpriseEditDraft
    try {
      values = await form.validateFields()
    } catch {
      return // 校验失败：Form 已在字段下展示错误提示
    }
    setSaving(true)
    try {
      await enterpriseApi.updateCurrent({
        display_name: values.displayName.trim(),
        full_name: values.fullName.trim(),
        industry: values.industry,
        description: values.description.trim(),
      })
      message.success('企业信息已保存')
      onClose()
      await enterpriseStore.refreshInfo()
    } catch (error: any) {
      message.error(error?.message || '企业信息保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="企业信息"
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
            label={<span>企业简称<span className="text-red-500 ml-0.5">*</span></span>}
            name="displayName"
            className="flex-1"
            required={false}
            rules={[{ required: true, message: '请输入企业简称' }]}
          >
            <Input maxLength={20} showCount placeholder="请输入企业简称" />
          </Form.Item>
          <Form.Item label="企业全称" name="fullName" className="flex-1">
            <Input maxLength={50} showCount placeholder="请输入企业全称" />
          </Form.Item>
        </div>
        <Form.Item label="所属行业" name="industry">
          <Select
            placeholder="请选择所属行业"
            allowClear
            showSearch
            optionFilterProp="label"
            options={INDUSTRY_OPTIONS.map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item label="企业介绍" name="description">
          <Input.TextArea
            rows={5}
            maxLength={1000}
            showCount
            placeholder="请输入企业介绍"
            style={{ resize: 'none' }}
            className="resize-none"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default EnterpriseEditModal