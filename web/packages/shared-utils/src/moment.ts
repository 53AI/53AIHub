/**
 * 时间工具函数集合
 * 提供常用的时间格式化、计算和转换功能
 */

// 时间常量定义
export const ONE_SECOND_TIMESTAMP = 1000
export const ONE_MINUTE_TIMESTAMP = 60 * ONE_SECOND_TIMESTAMP
export const ONE_HOUR_TIMESTAMP = 60 * ONE_MINUTE_TIMESTAMP
export const ONE_DAY_TIMESTAMP = 24 * ONE_HOUR_TIMESTAMP
export const ONE_WEEK_TIMESTAMP = 7 * ONE_DAY_TIMESTAMP

/** 星期文本映射 */
const WEEK_TEXT_LIST = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/**
 * 获取日期的时间戳
 * @param str 日期字符串，支持 yyyy-MM-dd 格式
 * @returns 时间戳（毫秒）
 */
export const getTimeStamp = (str: string): number => {
  return new Date(str.replace(/-/g, '/')).getTime()
}

/**
 * 日期格式化函数
 * 将 Date 对象或日期字符串转换为指定格式的字符串
 *
 * @param options 格式化选项
 * @param options.date 要格式化的日期，默认为当前时间
 * @param options.format 输出格式，默认为 'YYYY-MM-DD hh:mm:ss'
 * @param options.fillZero 是否自动补零，默认为 true
 * @returns 格式化后的日期字符串
 */
export const getSimpleDateFormatString = ({
  date = new Date(),
  format = 'YYYY-MM-DD hh:mm:ss',
  fillZero = true,
}: {
  date?: Date | string | number
  format?: string
  fillZero?: boolean
} = {}): string => {
  // 处理输入参数
  let targetDate: Date
  if (!date) {
    targetDate = new Date()
  } else if (typeof date === 'string') {
    targetDate = new Date(date.replace(/-/gm, '/'))
  } else {
    targetDate = new Date(date)
  }

  // 提取日期组件
  const year = targetDate.getFullYear().toString()
  const month = (targetDate.getMonth() + 1).toString()
  const day = targetDate.getDate().toString()
  const hour = targetDate.getHours().toString()
  const minute = targetDate.getMinutes().toString()
  const second = targetDate.getSeconds().toString()
  const week = targetDate.getDay()

  // 格式化字符串
  return format
    .replace('YYYY', year)
    .replace('YY', year.substring(2))
    .replace('MM', month.length === 1 && fillZero ? `0${month}` : month)
    .replace('DD', day.length === 1 && fillZero ? `0${day}` : day)
    .replace('hh', hour.length === 1 && fillZero ? `0${hour}` : hour)
    .replace('mm', minute.length === 1 && fillZero ? `0${minute}` : minute)
    .replace('ss', second.length === 1 && fillZero ? `0${second}` : second)
    .replace('week', WEEK_TEXT_LIST[week] || '')
}

/**
 * 获取当前日期字符串
 * @param format 输出格式
 * @returns 格式化后的当前日期字符串
 */
export const getCurrentDate = (format: string): string => {
  return getSimpleDateFormatString({ date: new Date(), format })
}

/**
 * 获取指定天数前的日期
 * @param day 天数
 * @param format 输出格式
 * @returns 格式化后的日期字符串
 */
export const getLastTimeAsDay = (
  day: number,
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setDate(date.getDate() - day)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取指定周数前的日期
 * @param week 周数
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @param timeOfDay 时间设置：'start' 设置为 00:00，'end' 设置为 23:59，不设置则保持原样
 * @returns 格式化后的日期字符串
 */
export const getLastTimeAsWeek = (
  week: number,
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setDate(date.getDate() - 7 * week)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取指定月数前的日期
 * @param month 月数
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @param timeOfDay 时间设置：'start' 设置为 00:00，'end' 设置为 23:59，不设置则保持原样
 * @returns 格式化后的日期字符串
 */
export const getLastTimeAsMonth = (
  month: number,
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setMonth(date.getMonth() - month)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取当前月份第一天
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @param timeOfDay 时间设置：'start' 设置为 00:00，'end' 设置为 23:59，不设置则保持原样
 * @returns 格式化后的日期字符串
 */
export const getCurrentMonth = (
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setDate(1)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取当前季度第一天
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @param timeOfDay 时间设置：'start' 设置为 00:00，'end' 设置为 23:59，不设置则保持原样
 * @returns 格式化后的日期字符串
 */
export const getCurrentQuarter = (
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setMonth(Math.floor(date.getMonth() / 3) * 3)
  date.setDate(1)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取当前年份第一天
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @param timeOfDay 时间设置：'start' 设置为 00:00，'end' 设置为 23:59，不设置则保持原样
 * @returns 格式化后的日期字符串
 */
export const getCurrentYear = (
  format: string,
  timeOfDay?: 'start' | 'end'
): string => {
  const date = new Date()
  date.setMonth(0)
  date.setDate(1)
  if (timeOfDay === 'start') {
    date.setHours(0, 0, 0, 0)
  } else if (timeOfDay === 'end') {
    date.setHours(23, 59, 59, 999)
  }
  return getSimpleDateFormatString({ date, format })
}

/**
 * 获取指定日期范围内的所有日期
 * @param start 开始日期字符串
 * @param end 结束日期字符串
 * @param format 输出格式，默认为 'YYYY-MM-DD'
 * @returns 日期字符串数组
 */
export const getDatesInRange = (start: string, end: string, format = 'YYYY-MM-DD'): string[] => {
  const startDate = new Date(start.replace(/-/g, '/'))
  const endDate = new Date(end.replace(/-/g, '/'))
  const dates: string[] = []

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    dates.push(getSimpleDateFormatString({ date: new Date(date), format }))
  }

  return dates
}

/**
 * 获取相对时间描述
 * 将时间戳转换为"xx前"或"昨天"等相对时间描述
 *
 * @param time 时间戳或日期字符串（支持秒级和毫秒级时间戳）
 * @returns 相对时间描述字符串
 */
export const getFormatTimeStamp = (time: number | string, format='YYYY-MM-DD hh:mm'): string => {
  // 处理秒级时间戳：如果数值小于 1e12，认为是秒级，需要乘以 1000
  const timestamp = typeof time === 'number' && time < 1e12 ? time * 1000 : time
  const date = new Date(timestamp)
  const now = new Date()
  const intervalSeconds = Math.ceil((now.getTime() - date.getTime()) / 1000) || 1

  // 计算日期差（基于日历天数，而非秒数差）
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.floor((todayStart.getTime() - dateStart.getTime()) / ONE_DAY_TIMESTAMP)

  // 时间单位用于显示"xx前"
  const timeUnits = [
    { seconds: 3600, label: '小时' },
    { seconds: 60, label: '分钟' },
    { seconds: 1, label: '秒' },
  ]

  // 优先按日期差判断
  if (dayDiff === 0) {
    // 今天：显示"xx前"
    for (const unit of timeUnits) {
      const tempResult = Math.floor(intervalSeconds / unit.seconds)
      if (tempResult > 0) {
        return `${tempResult}${unit.label}前`
      }
    }
    return '刚刚'
  } else if (dayDiff === 1) {
    // 昨天
    return '昨天'
  } else {
    // 2天及更早：显示具体日期
    return getSimpleDateFormatString({ date, format })
  }
}

/**
 * 获取时间戳
 * @param dateStr 日期字符串，为空时返回当前时间戳
 * @returns 时间戳（毫秒）
 */
export const getDateTimestamp = (dateStr = ''): number => {
  if (!dateStr) return new Date().getTime()

  const normalizedDateStr = Number.isNaN(Number(dateStr)) ? dateStr.replace(/-/g, '/') : dateStr

  return new Date(normalizedDateStr).getTime()
}

/**
 * 倒计时功能
 * @param endTime 结束时间字符串
 * @param advance 提前结束的毫秒数
 * @param callback 回调函数
 */
let countDownTimer: ReturnType<typeof setInterval> | null = null
export const countDown = (
  endTime = '',
  advance = 0,
  callback?: (info: { distance: number; status: 'complete' | 'pending' }) => void
) => {
  if (!endTime) return
  const countDownTime = getDateTimestamp(endTime)
  if (countDownTimer) {
    clearInterval(countDownTimer)
    countDownTimer = null
  }
  countDownTimer = setInterval(() => {
    const nowTime = new Date().getTime()
    const distance = countDownTime - nowTime
    if (distance < advance) {
      clearInterval(countDownTimer!)
      countDownTimer = null
      if (callback) callback({ distance, status: 'complete' })
      return
    }
    if (callback) callback({ distance, status: 'pending' })
  }, 1000)
}
