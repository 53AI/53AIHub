import React from 'react'
import { DatePicker } from 'antd'
import type { RangePickerProps } from 'antd/es/date-picker'
import dayjs, { Dayjs } from 'dayjs'
import { dateRangeOptions, getRangeStartEndDates } from '@/utils/filter'

const { RangePicker } = DatePicker

export interface DateRangeProps {
  value?: (string | number)[]
  onChange?: (data: (string | number)[]) => void
  prop?: {
    start: string
    end: string
  }
  startPlaceholder?: string
  endPlaceholder?: string
  size?: 'small' | 'middle' | 'large'
  valueFormat?: (date: Date) => string
  className?: string
  style?: React.CSSProperties
}

// Get the i18n translation function
const $t = (key: string) => {
  if (typeof window !== 'undefined' && (window as any).$t) {
    return (window as any).$t(key)
  }
  return key
}

// Default date format function
const defaultDateFormat = (date: Date): string => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

export const DateRange: React.FC<DateRangeProps> = (props) => {
  const {
    value = [],
    onChange,
    prop = { start: 'start', end: 'end' },
    startPlaceholder = $t('filter.start_time'),
    endPlaceholder = $t('filter.end_time'),
    size = 'middle',
    valueFormat = defaultDateFormat,
    className,
    style,
  } = props

  // Convert value to dayjs range
  const getDayjsValue = (): [Dayjs | null, Dayjs | null] | null => {
    if (!value || value.length < 2) return null
    return [dayjs(value[0] as string), dayjs(value[1] as string)]
  }

  // Handle date change
  const handleChange: RangePickerProps['onChange'] = (dates) => {
    if (!dates || !dates[0] || !dates[1]) {
      onChange?.([])
      return
    }

    const startDate = dates[0].toDate()
    const endDate = dates[1].toDate()
    
    // Set hours
    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    const formattedDates = [
      valueFormat(startDate),
      valueFormat(endDate),
    ]
    
    onChange?.(formattedDates)
  }

  // Generate shortcuts from dateRangeOptions
  const shortcuts = dateRangeOptions.map((item) => ({
    label: item.label,
    value: () => {
      const { start, end } = getRangeStartEndDates(item.value)
      if (start && end) {
        return [dayjs(start), dayjs(end)] as [Dayjs, Dayjs]
      }
      return [dayjs(), dayjs()] as [Dayjs, Dayjs]
    },
  }))

  return (
    <RangePicker
      value={getDayjsValue()}
      onChange={handleChange}
      startPlaceholder={startPlaceholder}
      endPlaceholder={endPlaceholder}
      size={size}
      style={{ width: 280, ...style }}
      className={className}
      presets={shortcuts}
      placement="bottomLeft"
    />
  )
}

export default DateRange