/**
 * 日期范围选项
 */
export const dateRangeOptions: { value: string; label: string }[] = [
  { value: '0', label: '今天' },
  { value: '1', label: '最近7天' },
  { value: '2', label: '最近4周' },
  { value: '3', label: '最近3个月' },
  { value: '4', label: '最近12个月' },
  { value: '5', label: '本月' },
  { value: '6', label: '本季度' },
  { value: '7', label: '今年' },
  { value: '8', label: '全部时间' }
]

/**
 * 获取日期范围的开始和结束日期
 * @param time_type 时间类型
 */
export const getRangeStartEndDates = (time_type: string): { start?: string | null; end?: string | null } => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (time_type) {
    case '0': // 今天
      return { start: today.toISOString(), end: now.toISOString() }

    case '1': { // 最近7天
      const start = new Date(today)
      start.setDate(start.getDate() - 6)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '2': { // 最近4周
      const start = new Date(today)
      start.setDate(start.getDate() - 27)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '3': { // 最近3个月
      const start = new Date(today)
      start.setMonth(start.getMonth() - 3)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '4': { // 最近12个月
      const start = new Date(today)
      start.setFullYear(start.getFullYear() - 1)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '5': { // 本月
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '6': { // 本季度
      const quarter = Math.floor(now.getMonth() / 3)
      const start = new Date(now.getFullYear(), quarter * 3, 1)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '7': { // 今年
      const start = new Date(now.getFullYear(), 0, 1)
      return { start: start.toISOString(), end: now.toISOString() }
    }

    case '8': // 全部时间
      return { start: null, end: null }

    default:
      return { start: null, end: null }
  }
}
