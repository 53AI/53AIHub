import { useMemo, useState } from 'react'
import { Button } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { DeptMemberPicker } from '../DeptMemberPicker'
import type { SelectItem } from '../DeptMemberPicker'
import { t } from '@/locales'
import './index.css'

interface FilterUserProps {
  value?: SelectItem[]
  onChange?: (value: SelectItem[]) => void
  multiple?: boolean
  defaultFirstValue?: boolean
}

export function FilterUser({
  value = [],
  onChange,
  multiple = false,
  defaultFirstValue = false,
}: FilterUserProps) {
  const [pickerVisible, setPickerVisible] = useState(false)

  const label = useMemo(() => {
    if (value.length === 0) return t('all')
    return value.map((item) => item.label || item.name).join(',')
  }, [value, t])

  const handleConfirm = (selected: SelectItem[]) => {
    onChange?.(selected)
    setPickerVisible(false)
  }

  return (
    <DeptMemberPicker
      value={value}
      onChange={onChange}
      multiple={multiple}
      defaultFirstValue={defaultFirstValue}
      onConfirm={handleConfirm}
      trigger={
        <Button className="filter-select-trigger">
          {label}
          <DownOutlined style={{ fontSize: 14, color: '#9EA5B6' }} />
        </Button>
      }
    />
  )
}

export default FilterUser
