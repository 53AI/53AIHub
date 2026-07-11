import { DatePicker } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

// Re-export sub-components
export { DateRangeFilter } from './date-range'
export { SelectFilter } from './select'
export { UserFilter } from './user'

export interface FilterSelectProps {
  options: Array<Record<string, any>>
  prop?: {
    value: string
    label: string
  }
  value?: string | number | null
  showAll?: boolean
  allOption?: {
    value: null
    label: string
  }
  onChange?: (value: string | number | null) => void
}

export function FilterSelect({
  options = [],
  prop = { value: 'value', label: 'label' },
  value = '',
  showAll = false,
  allOption = { value: null, label: '全部' },
  onChange,
}: FilterSelectProps) {
  // Merge options
  const mergedOptions = useMemo(() => {
    if (!showAll) return options
    return [{ [prop.value]: allOption.value, [prop.label]: allOption.label }, ...options]
  }, [options, showAll, allOption, prop])

  // Get label
  const label = useMemo(() => {
    return mergedOptions.find((opt) => opt[prop.value] === value)?.[prop.label] || ''
  }, [mergedOptions, value, prop])

  // Dropdown items
  const items = mergedOptions.map((opt) => ({
    key: String(opt[prop.value]),
    label: opt[prop.label],
    onClick: () => onChange?.(opt[prop.value]),
  }))

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <div className="border-none outline-none h-9 flex items-center px-5 gap-1.5 rounded-2xl bg-[#F6F7F8] text-xs text-primary cursor-pointer">
        {label}
        <DownOutlined style={{ fontSize: 14, color: '#9EA5B6' }} />
      </div>
    </Dropdown>
  )
}

export interface FilterDateRangeProps {
  value?: [string, string]
  startPlaceholder?: string
  endPlaceholder?: string
  onChange?: (value: [string, string] | null) => void
}

export function FilterDateRange({
  value,
  startPlaceholder = '开始时间',
  endPlaceholder = '结束时间',
  onChange,
}: FilterDateRangeProps) {
  // Shortcuts
  const ranges: Record<string, [dayjs.Dayjs, dayjs.Dayjs]> = {
    今天: [dayjs().startOf('day'), dayjs().endOf('day')],
    昨天: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')],
    近7天: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')],
    近30天: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')],
    本月: [dayjs().startOf('month'), dayjs().endOf('month')],
    上月: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
  }

  const handleChange = (dates: any) => {
    if (dates) {
      const [start, end] = dates
      onChange?.([
        start.startOf('day').format('YYYY-MM-DD HH:mm'),
        end.endOf('day').format('YYYY-MM-DD HH:mm'),
      ])
    } else {
      onChange?.(null)
    }
  }

  return (
    <RangePicker
      value={value ? [dayjs(value[0]), dayjs(value[1])] : null}
      onChange={handleChange}
      placeholder={[startPlaceholder, endPlaceholder]}
      style={{ width: 280 }}
      ranges={ranges}
    />
  )
}

export default {
  FilterSelect,
  FilterDateRange,
}
