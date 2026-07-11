import { useState, forwardRef, useImperativeHandle, useMemo } from 'react'
import { Modal, Form, Input, Select, InputNumber, Switch, Slider, Button, Radio } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { t } from '@/locales'
import { generateRandomId } from '@/utils'
import { generateInputRules } from '@/utils/form-rule'
import { inputTypeList, outputTypeList } from '@/constants/agent'
import { AGENT_TYPES } from '@/constants/platform/config'

interface FieldItem {
  id: string
  variable: string
  label: string
  type: string
  desc: string
  required: boolean
  max_length: number
  show_word_limit: boolean
  options: { id: string; label: string; value: string }[]
  multiple: boolean
  date_format: string
  file_type: string
  file_accept: string[]
  file_limit: number
  file_size: number
  is_system: boolean
}

interface FieldInputSettingProps {
  type: 'input' | 'output'
  agentType: string
  onSave: (value: FieldItem) => void
}

export interface FieldInputSettingRef {
  open: (data?: Partial<FieldItem>) => void
}

const defaultField: FieldItem = {
  id: '',
  variable: '',
  label: '',
  type: 'text',
  desc: '',
  required: false,
  max_length: 0,
  show_word_limit: false,
  options: [],
  multiple: false,
  date_format: '',
  file_type: 'all',
  file_accept: [],
  file_limit: 1,
  file_size: 30,
  is_system: false,
}

export const FieldInputSetting = forwardRef<FieldInputSettingRef, FieldInputSettingProps>(
  ({ type, agentType, onSave }, ref) => {
    const [form] = Form.useForm()
    const [visible, setVisible] = useState(false)
    const [widgetForm, setWidgetForm] = useState<FieldItem>(defaultField)

    const typeList = useMemo(() => {
      return (type === 'input' ? inputTypeList : outputTypeList).filter((item) =>
        item.allowed ? item.allowed.includes(agentType) : true
      )
    }, [type, agentType])

    const typeLabel = useMemo(() => {
      return [...inputTypeList, ...outputTypeList].find((item) => item.type === widgetForm.type)?.label || ''
    }, [widgetForm.type])

    const fileAcceptOptions = useMemo(() => {
      if (widgetForm.type.includes('file')) {
        return ['doc', 'docx', 'pdf', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'bmp', 'md', 'tiff', 'html']
      }
      if (widgetForm.type === 'array_image') {
        return ['png', 'jpg', 'bmp', 'tiff']
      }
      if (widgetForm.type === 'array_audio') {
        return ['mp3', 'wav', 'flac', 'aac', 'ogg']
      }
      if (widgetForm.type === 'array_video') {
        return ['mp4', 'mov', 'flv', 'wmv']
      }
      return []
    }, [widgetForm.type])

    const showFileLimit = useMemo(() => {
      return agentType === AGENT_TYPES.COZE_WORKFLOW_CN ? widgetForm.type !== 'file' : true
    }, [agentType, widgetForm.type])

    const handleType = (itemType: string) => {
      const newForm = { ...widgetForm, type: itemType }
      if (
        agentType === AGENT_TYPES.COZE_WORKFLOW_CN &&
        ['file', 'array_image', 'array_audio', 'array_video', 'array_file'].includes(itemType)
      ) {
        newForm.file_accept = []
        if (itemType === 'file') newForm.file_limit = 1
        if (['array_image', 'array_audio', 'array_video'].includes(itemType)) {
          newForm.file_type = 'custom'
        } else {
          newForm.file_type = 'all'
        }
      }
      setWidgetForm(newForm)
    }

    const handleAddOption = () => {
      setWidgetForm({
        ...widgetForm,
        options: [...widgetForm.options, { id: '', label: '', value: '' }],
      })
    }

    const handleDelOption = (index: number) => {
      const newOptions = [...widgetForm.options]
      newOptions.splice(index, 1)
      setWidgetForm({ ...widgetForm, options: newOptions })
    }

    const handleOptionChange = (index: number, label: string) => {
      const newOptions = [...widgetForm.options]
      newOptions[index] = { ...newOptions[index], label }
      setWidgetForm({ ...widgetForm, options: newOptions })
    }

    const handleFileTypeChange = (fileType: string, form: FieldItem) => {
      form.file_accept = []
      setWidgetForm({ ...widgetForm, file_type: fileType, file_accept: [] })
    }

    const handleSave = async () => {
      try {
        await form.validateFields()
        onSave({
          ...widgetForm,
          id: widgetForm.id || generateRandomId(10),
        })
        setVisible(false)
      } catch (error) {
        console.error('Validation failed:', error)
      }
    }

    useImperativeHandle(ref, () => ({
      open: (data = {} as Partial<FieldItem>) => {
        const newForm = {
          id: data.id || '',
          variable: data.variable || '',
          label: data.label || '',
          type: data.type || typeList[0]?.type,
          desc: data.desc || '',
          required: data.required || false,
          max_length: data.max_length || 0,
          show_word_limit: data.show_word_limit || false,
          options: data.options || [],
          multiple: data.multiple || false,
          date_format: data.date_format || '',
          file_type: data.file_type || 'all',
          file_accept: data.file_accept || [],
          file_limit: data.file_limit || 1,
          file_size: data.file_size || 30,
          is_system: data.is_system || false,
        }
        setWidgetForm(newForm)
        // 同步表单值，使 Form.Item 的 name 字段能正确验证
        form.setFieldsValue({
          variable: newForm.variable,
          label: newForm.label,
          file_accept: newForm.file_accept,
        })
        setVisible(true)
      },
    }))

    return (
      <Modal
        open={visible}
        onCancel={() => setVisible(false)}
        onOk={handleSave}
        title={widgetForm.id ? t('action.edit') : t('action.add')}
        width={600}
        destroyOnHidden
        className="field-form-dialog"
        footer={
          <>
            <Button onClick={() => setVisible(false)}>{t('action.cancel')}</Button>
            <Button type="primary" onClick={handleSave}>
              {t('action.save')}
            </Button>
          </>
        }
      >
        <Form
          form={form}
          layout="vertical"
          style={{ width: '540px' }}
          className="pt-4"
        >
          <Form.Item
            label={t('agent.variable_name')}
            name="variable"
            rules={generateInputRules({ message: 'form.input_placeholder', validator: ['variable'] })}
            required
          >
            <Input
              value={widgetForm.variable}
              disabled={widgetForm.is_system}
              maxLength={30}
              showCount
              placeholder={t('form.input_placeholder') + t('agent.variable_name')}
              onChange={(e) => setWidgetForm({ ...widgetForm, variable: e.target.value })}
            />
          </Form.Item>

          <Form.Item
            label={t('agent.variable_label')}
            name="label"
            rules={generateInputRules({ message: 'form.input_placeholder' })}
            required
          >
            <Input
              value={widgetForm.label}
              maxLength={30}
              showCount
              placeholder={t('form.input_placeholder') + t('agent.variable_label')}
              onChange={(e) => setWidgetForm({ ...widgetForm, label: e.target.value })}
            />
          </Form.Item>

          <Form.Item label={t('agent.variable_type')}>
            {widgetForm.is_system ? (
              <Input disabled value={typeLabel} placeholder={t('form.input_placeholder')} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {typeList.map((item) => (
                  <div
                    key={item.type}
                    className={`w-[100px] h-10 border rounded flex-center gap-1 cursor-pointer ${
                      widgetForm.type === item.type
                        ? 'border-[#2563EB] text-brand bg-[#2563EB] bg-opacity-[8%]'
                        : 'text-dark bg-[#F9FAFC]'
                    }`}
                    onClick={() => handleType(item.type)}
                  >
                    <span className="text-sm">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </Form.Item>

          {['date'].includes(widgetForm.type) && (
            <Form.Item label={t('form.select_placeholder')}>
              <Select
                value={widgetForm.date_format}
                className="w-full"
                placeholder="请选择"
                onChange={(v) => setWidgetForm({ ...widgetForm, date_format: v })}
                options={[
                  { label: '年', value: 'y' },
                  { label: '年/月', value: 'y-m' },
                  { label: '年/月/日', value: 'y-m-d' },
                  { label: '时/分', value: 'h-m' },
                  { label: '时间范围', value: 'daterange' },
                ]}
              />
            </Form.Item>
          )}

          {type === 'input' && (
            <Form.Item label={t('agent.variable_desc')}>
              <Input
                value={widgetForm.desc}
                maxLength={1000}
                showCount
                placeholder={t('form.input_placeholder')}
                onChange={(e) => setWidgetForm({ ...widgetForm, desc: e.target.value })}
              />
            </Form.Item>
          )}

          {type === 'input' && (
            <Form.Item label={t('agent.variable_required')}>
              <Switch
                checked={widgetForm.required}
                onChange={(checked) => setWidgetForm({ ...widgetForm, required: checked })}
              />
            </Form.Item>
          )}

          {['text', 'textarea', 'array_text'].includes(widgetForm.type) && type === 'input' && (
            <Form.Item label={t('agent.variable_max_length')}>
              <InputNumber
                value={widgetForm.max_length}
                style={{ width: '100%' }}
                className="ant-input-number-left"
                precision={0}
                controls={false}
                maxLength={256}
                placeholder={t('form.input_placeholder')}
                onChange={(v) => setWidgetForm({ ...widgetForm, max_length: v || 0 })}
              />
            </Form.Item>
          )}

          {['text', 'textarea', 'array_text'].includes(widgetForm.type) && type === 'input' && (
            <Form.Item label={t('agent.variable_show_word_limit')}>
              <Switch
                checked={widgetForm.show_word_limit}
                onChange={(checked) => setWidgetForm({ ...widgetForm, show_word_limit: checked })}
              />
            </Form.Item>
          )}

          {widgetForm.type === 'select' && (
            <Form.Item label={t('agent.variable_options')}>
              <div className="flex flex-col gap-3 w-full">
                {widgetForm.options.map((item, index) => (
                  <div key={item.value || item.id || index} className="flex items-center">
                    <Input
                      value={item.label}
                      className="flex-1"
                      placeholder={t('form.input_placeholder')}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                    />
                    <div className="px-2">
                      <SvgIcon
                        name="delete"
                        className="cursor-pointer"
                        style={{ color: '#999999' }}
                        onClick={() => handleDelOption(index)}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="w-full h-10 leading-10 rounded text-center border border-dashed border-[#DCDFE6] cursor-pointer text-sm text-dark text-opacity-80 mt-3"
                onClick={handleAddOption}
              >
                + {t('action.add')}
              </div>
            </Form.Item>
          )}

          {widgetForm.type === 'select' && (
            <Form.Item label="模式">
              <Radio.Group
                value={widgetForm.multiple}
                onChange={(e) => setWidgetForm({ ...widgetForm, multiple: e.target.value })}
              >
                <Radio value={false}>单选</Radio>
                <Radio value={true}>多选</Radio>
              </Radio.Group>
            </Form.Item>
          )}

          {['file', 'array_image', 'array_audio', 'array_video', 'array_file'].includes(widgetForm.type) &&
            type === 'input' && (
              <>
                {!['array_image', 'array_audio', 'array_video'].includes(widgetForm.type) && (
                  <Form.Item label="上传文件类型">
                    <Select
                      value={widgetForm.file_type}
                      className="w-full"
                      placeholder="请选择"
                      onChange={(v) => handleFileTypeChange(v, widgetForm)}
                      options={[
                        { label: '不限格式', value: 'all' },
                        { label: '自定义', value: 'custom' },
                      ]}
                    />
                  </Form.Item>
                )}

                {widgetForm.file_type === 'custom' && (
                  <Form.Item
                    label="支持文件格式"
                    name="file_accept"
                    rules={generateInputRules({ message: 'form.select_placeholder' })}
                    required
                  >
                    <Select
                      mode="multiple"
                      value={widgetForm.file_accept}
                      className="w-full"
                      placeholder="请选择"
                      onChange={(v) => setWidgetForm({ ...widgetForm, file_accept: v })}
                      options={fileAcceptOptions.map((item) => ({
                        label: item === 'md' ? 'markdown' : item,
                        value: item,
                      }))}
                    />
                  </Form.Item>
                )}

                <Form.Item label="单个文件上限">
                  <div className="w-full flex items-center gap-5 overflow-hidden">
                    <div className="flex-1">
                      <Slider
                        value={widgetForm.file_size}
                        min={1}
                        max={300}
                        onChange={(v) => setWidgetForm({ ...widgetForm, file_size: v })}
                      />
                    </div>
                    <span className="text-sm text-dark">{widgetForm.file_size}M</span>
                  </div>
                </Form.Item>

                {showFileLimit && (
                  <Form.Item label="上传最大数量">
                    <div className="flex items-center gap-2">
                      <InputNumber
                        value={widgetForm.file_limit}
                        precision={0}
                        min={1}
                        max={6}
                        placeholder="请输入"
                        onChange={(v) => setWidgetForm({ ...widgetForm, file_limit: v || 1 })}
                      />
                      <span className="text-sm text-dark">个</span>
                    </div>
                  </Form.Item>
                )}
              </>
            )}
        </Form>
      </Modal>
    )
  }
)

FieldInputSetting.displayName = 'FieldInputSetting'

export default FieldInputSetting
