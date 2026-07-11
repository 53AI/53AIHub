import { useCallback, useRef } from 'react'
import { Input, Form, Button } from 'antd'
import { GroupSelect } from '@/components/GroupSelect'
import { GROUP_TYPE } from '@/constants/group'
import { ImageUpload, type ImageUploadRef } from '@/components/Upload/image'

export interface SkillBasicInfoValue {
  name: string
  display_name: string
  description: string
  logo: string
  groups: number[]
}

export interface SkillBasicInfoProps {
  /** 基本信息数据 */
  value: SkillBasicInfoValue
  /** 数据变更回调 */
  onChange: (value: SkillBasicInfoValue) => void
  /** 翻译函数 */
  t?: (key: string) => string
  /** 自定义类名 */
  className?: string
}

export function SkillBasicInfo({
  value,
  onChange,
  t: translate = (key) => key,
  className,
}: SkillBasicInfoProps) {
  const imageUploadRef = useRef<ImageUploadRef>(null)
  const handleLogoChange = useCallback((logo: string) => {
    onChange({ ...value, logo })
  }, [value, onChange])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, display_name: e.target.value })
  }, [value, onChange])

  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...value, description: e.target.value })
  }, [value, onChange])

  const handleGroupChange = useCallback((groups: number[]) => {
    onChange({ ...value, groups })
  }, [value, onChange])

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
        <div className="flex gap-3">
          <Form.Item
            required
            className="flex-1 mb-0"
          >
            <Input
              value={value.display_name}
              onChange={handleNameChange}
              placeholder={translate('skills.placeholder.display_name')}
              maxLength={50}
              showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
            />
          </Form.Item>
          {/* 分组选择器 */}
          <Form.Item
            required
            className="flex-1 mb-0"
          >
            <GroupSelect
              groupType={GROUP_TYPE.SKILLS}
              mode="multiple"
              value={value.groups}
              onChange={handleGroupChange}
              defaultFirst
              placeholder={translate('form_select_placeholder')}
            />
          </Form.Item>
        </div>
        <Form.Item className="mb-0">
          <Input.TextArea
            value={value.description}
            onChange={handleDescChange}
            placeholder={translate('skills.description_placeholder')}
            rows={3}
            maxLength={500}
            showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
            style={{ resize: 'none' }}
          />
        </Form.Item>
      </div>
    </div>
  )
}

export default SkillBasicInfo
