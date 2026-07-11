import { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Input, Form, Button } from 'antd'
import { GroupSelect } from '@/components/GroupSelect'
import { GROUP_TYPE } from '@/constants/group'
import { ImageUpload, type ImageUploadRef } from '@/components/Upload/image'

export interface PromptBasicInfoValue {
  name: string
  description: string
  logo: string
  group_ids: number[]
}

export interface PromptBasicInfoProps {
  /** 基本信息数据 */
  value: PromptBasicInfoValue
  /** 数据变更回调 */
  onChange: (value: PromptBasicInfoValue) => void
  /** 翻译函数 */
  t?: (key: string) => string
  /** 自定义类名 */
  className?: string
}

export interface PromptBasicInfoRef {
  validate: () => Promise<boolean>
}

export const PromptBasicInfo = forwardRef<PromptBasicInfoRef, PromptBasicInfoProps>(
  ({ value, onChange, t: translate = (key) => key, className }, ref) => {
    const [form] = Form.useForm()
    const imageUploadRef = useRef<ImageUploadRef>(null)

    const handleLogoChange = useCallback((logo: string) => {
      onChange({ ...value, logo })
    }, [value, onChange])

    const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, name: e.target.value })
    }, [value, onChange])

    const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...value, description: e.target.value })
    }, [value, onChange])

    const handleGroupChange = useCallback((group_ids: number[]) => {
      onChange({ ...value, group_ids })
    }, [value, onChange])

    const validate = async () => {
      try {
        await form.validateFields()
        return true
      } catch {
        return false
      }
    }

    useImperativeHandle(ref, () => ({
      validate,
    }))

    // 同步 form 数据
    useEffect(() => {
      form.setFieldsValue({
        name: value.name,
        group_ids: value.group_ids,
      })
    }, [value.name, value.group_ids, form])

    return (
      <div className={`flex gap-4 ${className || ''}`}>
        {/* 头像 */}
        <div className="flex flex-col items-center gap-2">
          <ImageUpload
            ref={imageUploadRef}
            value={value.logo}
            onChange={handleLogoChange}
            className="!w-[72px] !h-[72px] rounded-lg"
          />
          <Button
            className="w-[72px] text-xs"
            onClick={() => imageUploadRef.current?.trigger()}
          >
            {translate('agent.change_avatar')}
          </Button>
        </div>

        {/* 名称和描述 */}
        <div className="flex-1 space-y-2">
          <Form form={form} layout="vertical">
            <div className="flex gap-3">
              <Form.Item
                name="name"
                rules={[{ required: true, message: translate('form_input_placeholder') }]}
                className="flex-1 mb-0"
              >
                <Input
                  value={value.name}
                  onChange={handleNameChange}
                  placeholder={translate('form_input_placeholder')}
                  maxLength={20}
                  showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
                />
              </Form.Item>
              {/* 分组选择器 */}
              <Form.Item
                name="group_ids"
                rules={[{ required: true, message: translate('form_select_placeholder') }]}
                className="flex-1 mb-0"
              >
                <GroupSelect
                  groupType={GROUP_TYPE.PROMPT}
                  mode="multiple"
                  value={value.group_ids}
                  onChange={handleGroupChange}
                  defaultFirst
                  placeholder={translate('form_select_placeholder')}
                />
              </Form.Item>
            </div>
          </Form>
          <Form.Item className="mb-0">
            <Input.TextArea
              value={value.description}
              onChange={handleDescChange}
              placeholder={translate('form_input_placeholder')}
              rows={3}
              maxLength={200}
              showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
              style={{ resize: 'none' }}
            />
          </Form.Item>
        </div>
      </div>
    )
  }
)

PromptBasicInfo.displayName = 'PromptBasicInfo'

export default PromptBasicInfo
