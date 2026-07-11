import { useRef, useEffect } from 'react'
import { Input, Button } from 'antd'
import { UploadImage } from '@/components/Upload/image'
import { t } from '@/locales'

interface BasicInfoProps {
  value: {
    name: string
    description: string
    logo: string
  }
  onChange: (value: { name: string; description: string; logo: string }) => void
}

export function BasicInfo({ value, onChange }: BasicInfoProps) {
  const uploadImageRef = useRef<{ trigger: () => void }>(null)

  return (
    <div className="space-y-3">
      {/* Basic info form */}
      <div className="flex gap-4">
        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-2">
          <UploadImage
            ref={uploadImageRef}
            value={value.logo}
            onChange={(logo) => onChange({ ...value, logo })}
            text={t('action.replace')}
            className="!size-[72px]"
          />
          <Button
            className="w-[72px] text-xs"
            onClick={() => uploadImageRef.current?.trigger()}
          >
            {t('agent.change_avatar')}
          </Button>
        </div>
        {/* Name and description */}
        <div className="flex-1 space-y-3">
          <Input
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder={t('agent.bot_name_placeholder')}
            maxLength={20}
            showCount
          />
          <Input.TextArea
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            placeholder={t('agent.bot_desc_placeholder')}
            rows={3}
            maxLength={100}
            showCount
          />
        </div>
      </div>
    </div>
  )
}

export default BasicInfo
