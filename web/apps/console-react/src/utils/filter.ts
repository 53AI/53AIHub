import { getRangeStartEndDates as getRangeStartEndDatesFromShared } from '@km/shared-utils'

export const dateRangeOptions: { value: string; label: string }[] = [
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

export function getRangeStartEndDates(
  time_type: string,
): { start?: string | null; end?: string | null } {
  return getRangeStartEndDatesFromShared(time_type)
}
