import { useMemo, useState, useCallback, useEffect } from 'react'
import { DownOutlined } from '@ant-design/icons'
import DeptMemberPicker, { DeptMemberPickerValue } from '@/components/DeptMemberPicker'

interface UserFilterProps {
  value?: string | number | null | DeptMemberPickerValue[]
  onChange?: (value: DeptMemberPickerValue[]) => void
  multiple?: boolean
  defaultFirstValue?: boolean
  isCleared?: boolean
}

export function UserFilter({
  value: propValue,
  onChange,
  multiple = false,
  defaultFirstValue = false,
  isCleared = false,
}: UserFilterProps) {
  const t = (window as any).$t || ((key: string) => key)

  const [user, setUser] = useState<DeptMemberPickerValue[]>([])

  // Handle clear
  useEffect(() => {
    if (isCleared) {
      setUser([])
    }
  }, [isCleared])

  // Compute display label
  const label = useMemo(() => {
    return user.map((item) => item.label).join(',') || t('all')
  }, [user, t])

  // Handle confirm
  const handleConfirm = useCallback(
    (data: DeptMemberPickerValue[]) => {
      setUser(data)
      onChange?.(data)
    },
    [onChange]
  )

  return (
    <DeptMemberPicker
      value={user}
      onChange={handleConfirm}
      multiple={multiple}
      defaultFirstValue={defaultFirstValue}
      trigger={
        <div className="border border-[rgb(217, 217, 217)] rounded-md h-8 min-w-44 flex items-center px-3 gap-1.5 text-xs text-primary overflow-hidden cursor-pointer">
          <p className="flex-1 text-sm text-primary truncate">{label}</p>
          <DownOutlined style={{ fontSize: 12, color: '#9EA5B6' }} />
        </div>
      }
    />
  )
}

export default UserFilter