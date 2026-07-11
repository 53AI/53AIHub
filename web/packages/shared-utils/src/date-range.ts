/**
 * 日期范围工具：根据 time_type 计算 start/end（依赖 moment 时间函数）
 */

import {
  getCurrentDate,
  getLastTimeAsDay,
  getLastTimeAsWeek,
  getLastTimeAsMonth,
  getCurrentMonth,
  getCurrentQuarter,
  getCurrentYear,
} from './moment.js'

export type DateRangeResult = { start?: string | null; end?: string | null }

/**
 * 根据筛选类型返回日期范围的 start、end 字符串
 * time_type: '0' 今天, '1' 过去7天, '2' 过去4周, '3' 过去3月, '4' 过去12月,
 *            '5' 本月至今, '6' 本季度至今, '7' 本年至今, '8' 所有时间
 */
export const getRangeStartEndDates = (time_type: string): DateRangeResult => {
  const options: DateRangeResult = {}
  let start = ''

  if (time_type === '0') {
    start = getCurrentDate('YYYY-MM-DD 00:01')
  } else if (time_type === '1') {
    start = getLastTimeAsDay(7, 'YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '2') {
    start = getLastTimeAsWeek(4, 'YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '3') {
    start = getLastTimeAsMonth(3, 'YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '4') {
    start = getLastTimeAsMonth(12, 'YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '5') {
    start = getCurrentMonth('YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '6') {
    start = getCurrentQuarter('YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '7') {
    start = getCurrentYear('YYYY-MM-DD hh:mm', 'start')
  } else if (time_type === '8') {
    start = '2022-01-01 00:00'
  }

  if (start) {
    options.start = start
    options.end = getCurrentDate('YYYY-MM-DD hh:mm')
  } else {
    options.start = null
    options.end = null
  }

  return options
}
