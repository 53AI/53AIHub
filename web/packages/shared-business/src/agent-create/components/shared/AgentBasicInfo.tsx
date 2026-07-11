import { useRef, useCallback, type ReactNode } from 'react'
import { Input, Button, Select } from 'antd'

export interface AgentBasicInfoValue {
  name: string
  description: string
  logo: string
}

export interface AgentBasicInfoProps {
  /** 基本信息数据 */
  value: AgentBasicInfoValue
  /** 数据变更回调 */
  onChange: (value: AgentBasicInfoValue) => void
  /** 头像上传组件 slot（render prop 模式） */
  avatarSlot?: (props: { value: string; onChange: (logo: string) => void }) => ReactNode
  /** 分组选择配置（后台扩展） */
  groupValue?: number
  onGroupChange?: (value: number) => void
  groupOptions?: Array<{ label: string; value: number }>
  /** 名称最大长度 */
  nameMaxLength?: number
  /** 描述最大长度 */
  descMaxLength?: number
  /** 名称 placeholder */
  namePlaceholder?: string
  /** 描述 placeholder */
  descPlaceholder?: string
  /** 翻译函数 */
  t?: (key: string) => string
  /** 自定义类名 */
  className?: string
}

export function AgentBasicInfo({
  value,
  onChange,
  avatarSlot,
  groupValue,
  onGroupChange,
  groupOptions,
  nameMaxLength = 20,
  descMaxLength = 100,
  namePlaceholder,
  descPlaceholder,
  t = (key) => key,
  className,
}: AgentBasicInfoProps) {
  const _namePlaceholder = namePlaceholder || t('agent.name_placeholder')
  const _descPlaceholder = descPlaceholder || t('agent.desc_placeholder')
  const uploadImageRef = useRef<HTMLInputElement>(null)

  const handleLogoChange = useCallback((logo: string) => {
    onChange({ ...value, logo })
  }, [value, onChange])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      handleLogoChange(url)
    }
  }, [handleLogoChange])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, name: e.target.value })
  }, [value, onChange])

  const handleDescChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...value, description: e.target.value })
  }, [value, onChange])

  // 默认头像上传实现（当没有 avatarSlot 时）
  const defaultAvatarRender = () => (
    <div className="flex flex-col items-center gap-2">
      <div
        className="size-[72px] rounded-lg border border-dashed border-[#E5E5E5] flex items-center justify-center overflow-hidden bg-[#F5F5F7] cursor-pointer"
        onClick={() => uploadImageRef.current?.click()}
      >
        {value.logo ? (
          <img src={value.logo} className="size-full object-cover" alt="avatar" />
        ) : (
          <span className="text-xs text-[#999]">{t('action.upload')}</span>
        )}
      </div>
      <input
        ref={uploadImageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        className="w-[72px] text-xs"
        onClick={() => uploadImageRef.current?.click()}
      >
        {t('agent.change_avatar')}
      </Button>
    </div>
  )

  return (
    <div className={`flex gap-4 ${className || ''}`}>
      {/* 头像 */}
      {avatarSlot ? avatarSlot({
        value: value.logo,
        onChange: handleLogoChange,
      }) : defaultAvatarRender()}

      {/* 名称和描述 */}
      <div className="flex-1 space-y-2">
        <div className="flex gap-3">
          <Input
            value={value.name}
            onChange={handleNameChange}
            placeholder={_namePlaceholder}
            maxLength={nameMaxLength}
            showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
            className={groupOptions ? 'flex-1' : 'flex-1'}
          />
          {/* 分组选择器 */}
          {groupOptions && (
            <Select
              value={groupValue}
              onChange={onGroupChange}
              options={groupOptions}
              placeholder={t('form.select_placeholder')}
              className="flex-1"
            />
          )}
        </div>
        <Input.TextArea
          value={value.description}
          onChange={handleDescChange}
          placeholder={_descPlaceholder}
          rows={3}
          maxLength={descMaxLength}
          showCount={{ formatter: ({ count, maxLength }) => `${count}/${maxLength}` }}
          style={{ resize: 'none' }}
        />
      </div>
    </div>
  )
}

export default AgentBasicInfo
