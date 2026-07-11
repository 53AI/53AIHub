import { DatePicker } from 'antd'
import { useMemo, useCallback } from 'react'
import dayjs, { Dayjs } from 'dayjs'
import { getRangeStartEndDates as getRangeStartEndDatesFromShared } from '@km/shared-utils'

const { RangePicker } = DatePicker

interface DateRange {
  start: string
  end: string
}

interface DateRangeProps {
  value?: (string | number)[]
  prop?: DateRange
  startPlaceholder?: string
  endPlaceholder?: string
  size?: 'small' | 'default' | 'large'
  valueFormat?: (date: Date) => string | number
  isCleared?: boolean
  onChange?: (value: (string | number)[]) => void
  onAdd?: () => void
}

// Date range options - matches Vue implementation
const dateRangeOptions: { value: string; label: string }[] = [
  { value: '0', label: '今天' },
  { value: '1', label: '过去7天' },
  { value: '2', label: '过去4周' },
  { value: '3', label: '过去3月' },
  { value: '4', label: '过去12月' },
  { value: '5', label: '本月至今' },
  { value: '6', label: '本季度至今' },
  { value: '7', label: '本年至今' },
  { value: '8', label: '所有时间' },
]

// Default value format function - returns timestamp
const defaultFormat = 'YYYY-MM-DD'
const defaultValueFormat = (date: Date): number => {
  return date.getTime()
}

// Get range dates from shared utility
const getRangeStartEndDates = (timeType: string): { start?: string | null; end?: string | null } => {
  return getRangeStartEndDatesFromShared(timeType)
}

// Map size to antd size
const mapSize = (size?: 'small' | 'default' | 'large'): 'small' | 'middle' | 'large' => {
  if (size === 'default') return 'middle'
  return size as 'small' | 'large'
}

export function DateRangeFilter({
  value,
  prop = { start: 'start', end: 'end' },
  startPlaceholder,
  endPlaceholder,
  size = 'default',
  valueFormat,
  isCleared,
  onChange,
  onAdd,
}: DateRangeProps) {
  const t = (window as any).$t || ((key: string) => key)

  // Use provided valueFormat or default to timestamp
  const formatValue = valueFormat || defaultValueFormat

  // Default placeholders with i18n
  const _startPlaceholder = startPlaceholder ?? t('start_time')
  const _endPlaceholder = endPlaceholder ?? t('end_time')

  // Convert string/number dates to Dayjs
  const dayjsValue = useMemo((): [Dayjs, Dayjs] | null => {
    if (!value || !value[0] || !value[1]) return null
    const start = typeof value[0] === 'number' ? dayjs(value[0]) : dayjs(value[0] as string)
    const end = typeof value[1] === 'number' ? dayjs(value[1]) : dayjs(value[1] as string)
    return [start, end]
  }, [value])

  // Handle manual date selection
  const handleChange = useCallback(
    (dates: [Dayjs | null, Dayjs | null] | null) => {
      let result: (string | number)[] = []
      if (dates && dates[0] && dates[1]) {
        const startDate = dates[0].toDate()
        const endDate = dates[1].toDate()
        // Manual selection: set hours before formatting
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
        result = [formatValue(startDate), formatValue(endDate)]
      }
      onChange?.(result)
    },
    [onChange, formatValue]
  )

  // Preset ranges - use onClick to directly call onChange with formatted values
  const presets = useMemo(
    () =>
      dateRangeOptions.map((item) => {
        const range = getRangeStartEndDates(item.value)
        if (!range.start || !range.end) return null

        // Pre-calculate the formatted values for onClick
        const startDate = dayjs(range.start).toDate()
        const endDate = dayjs(range.end).toDate()

        return {
          label: item.label,
          value: [dayjs(range.start), dayjs(range.end)] as [Dayjs, Dayjs],
          onClick: () => {
            // Directly call onChange with formatted timestamp values
            const formattedStart = formatValue(startDate)
            const formattedEnd = formatValue(endDate)
            onChange?.([formattedStart, formattedEnd])
          },
        }
      }).filter((item) => item !== null) as { label: string; value: [Dayjs, Dayjs]; onClick?: () => void }[],
    [formatValue, onChange]
  )

  return (
    <RangePicker
      value={dayjsValue}
      onChange={handleChange as any}
      startPlaceholder={_startPlaceholder}
      endPlaceholder={_endPlaceholder}
      size={mapSize(size)}
      style={{ width: 280 }}
      presets={presets}
      format={defaultFormat}
    />
  )
}

export default DateRangeFilter