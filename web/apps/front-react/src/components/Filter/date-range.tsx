import { useMemo } from 'react'
import { DatePicker } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { t } from '@/locales'
import './index.css'

const { RangePicker } = DatePicker

interface DateRangeProps {
  start: string
  end: string
}

interface DateRangeValue {
  start?: string
  end?: string
}

interface FilterDateRangeProps {
  value?: DateRangeValue
  onChange?: (value: DateRangeValue) => void
  prop?: DateRangeProps
  startPlaceholder?: string
  endPlaceholder?: string
  size?: 'small' | 'middle' | 'large'
  valueFormat?: (date: Date) => string
}

const dateRangeOptions = [
  { value: '0', labelKey: 'filter.date_range.today' },
  { value: '1', labelKey: 'filter.date_range.last_7_days' },
  { value: '2', labelKey: 'filter.date_range.last_4_weeks' },
  { value: '3', labelKey: 'filter.date_range.last_3_months' },
  { value: '4', labelKey: 'filter.date_range.last_12_months' },
  { value: '5', labelKey: 'filter.date_range.this_month' },
  { value: '6', labelKey: 'filter.date_range.this_quarter' },
  { value: '7', labelKey: 'filter.date_range.this_year' },
  { value: '8', labelKey: 'filter.date_range.all_time' },
]

const getRangeStartEndDates = (timeType: string): { start?: Date; end?: Date } => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (timeType) {
    case '0': // Today
      return { start: today, end: now }
    case '1': { // Last 7 days
      const start = new Date(today)
      start.setDate(start.getDate() - 6)
      return { start, end: now }
    }
    case '2': { // Last 4 weeks
      const start = new Date(today)
      start.setDate(start.getDate() - 27)
      return { start, end: now }
    }
    case '3': { // Last 3 months
      const start = new Date(today)
      start.setMonth(start.getMonth() - 3)
      return { start, end: now }
    }
    case '4': { // Last 12 months
      const start = new Date(today)
      start.setFullYear(start.getFullYear() - 1)
      return { start, end: now }
    }
    case '5': { // This month
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start, end: now }
    }
    case '6': { // This quarter
      const quarter = Math.floor(today.getMonth() / 3)
      const start = new Date(today.getFullYear(), quarter * 3, 1)
      return { start, end: now }
    }
    case '7': { // This year
      const start = new Date(today.getFullYear(), 0, 1)
      return { start, end: now }
    }
    case '8': // All time
      return { start: undefined, end: undefined }
    default:
      return { start: undefined, end: undefined }
  }
}

export function FilterDateRange({
  value,
  onChange,
  prop = { start: 'start', end: 'end' },
  startPlaceholder,
  endPlaceholder,
  size = 'middle',
  valueFormat = (date: Date) => getSimpleDateFormatString({ date, format: 'YYYY-MM-DD hh:mm' }),
}: FilterDateRangeProps) {
  const dateValue = useMemo<[Dayjs | null, Dayjs | null] | null>(() => {
    if (!value?.start || !value?.end) return null
    return [dayjs(value.start), dayjs(value.end)]
  }, [value])

  const handleChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (!dates || !dates[0] || !dates[1]) {
      onChange?.({})
      return
    }

    const startDate = dates[0].toDate()
    const endDate = dates[1].toDate()

    startDate.setHours(0, 0, 0, 0)
    endDate.setHours(23, 59, 59, 999)

    onChange?.({
      [prop.start]: valueFormat(startDate),
      [prop.end]: valueFormat(endDate),
    })
  }

  const shortcuts = dateRangeOptions.map((item) => ({
    label: t(item.labelKey),
    value: (() => {
      const range = getRangeStartEndDates(item.value)
      if (!range.start || !range.end) return null
      return [dayjs(range.start), dayjs(range.end)] as [Dayjs, Dayjs]
    })(),
  }))

  return (
    <RangePicker
      value={dateValue}
      onChange={handleChange}
      startPlaceholder={startPlaceholder || t('filter.start_time')}
      endPlaceholder={endPlaceholder || t('filter.end_time')}
      size={size}
      style={{ width: 280 }}
      presets={shortcuts.map((s) => ({
        label: s.label,
        value: s.value,
      }))}
    />
  )
}

export default FilterDateRange
