import { forwardRef, useImperativeHandle, useRef } from 'react'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { ResourcePicker, ResourcePickerRef } from '@/components/ResourcePicker'
import { GROUP_TYPE } from '@/constants/group'

interface SkillPickerProps {
  value?: any[]
  onChange?: (skills: any[]) => void
  disabled?: boolean
  maxCount?: number
  /** 翻译函数 */
  translate?: (key: string) => string
}

export interface SkillPickerRef {
  open: () => void
}

export const SkillPicker = forwardRef<SkillPickerRef, SkillPickerProps>(
  ({ value = [], onChange, disabled = false, maxCount = 6, translate }, ref) => {
    const t = translate || ((key: string) => key)
    const resourcePickerRef = useRef<ResourcePickerRef>(null)

    // 转换 value 格式为 ResourcePicker 需要的格式
    const resourcePickerValue = value.map((skill: any) => ({
      ...skill,
      id: skill.skill_library_id || skill.id,
      value: skill.skill_library_id || skill.id,
      label: skill.display_name || skill.skill_name,
    }))

    // 技能选择确认
    const handleConfirm = (result: { value: any[] }) => {
      // result.value 只包含新选中的技能（不含已选项）
      if (!result.value || result.value.length === 0) return

      // 避免重复添加
      const newSkills = result.value.filter((skill: any) => {
        const skillLibraryId = skill.skill_library_id || skill.id
        return !value.some((s: any) => s.skill_library_id === skillLibraryId)
      })

      // 手动合并已选项和新选项
      const allSkills = [
        ...value,
        ...newSkills.map((skill: any) => ({
          skill_id: skill.skill_id || skill.id,
          skill_library_id: skill.skill_library_id || skill.id,
          display_name: skill.display_name || skill.label,
          skill_name: skill.skill_name,
          logo: skill.logo,
          description: skill.description,
        })),
      ]

      onChange?.(allSkills)
    }

    useImperativeHandle(ref, () => ({
      open: () => resourcePickerRef.current?.open(),
    }))

    return (
      <ResourcePicker
        ref={resourcePickerRef}
        value={resourcePickerValue}
        groupType={GROUP_TYPE.SKILLS}
        title={t('action_add')}
        onConfirm={handleConfirm}
      >
        <Button
          color="default"
          variant="link"
          icon={<PlusOutlined />}
          className="px-0"
          disabled={disabled || value.length >= maxCount}
        >
        </Button>
      </ResourcePicker>
    )
  }
)

SkillPicker.displayName = 'SkillPicker'

export default SkillPicker
