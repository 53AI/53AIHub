/**
 * 全局过滤器/格式化工具函数
 * 
 * Vue filters → React utility functions
 */

import { getFormatTimeStamp, getSimpleDateFormatString } from '@km/shared-utils'

/**
 * 数字添加千分位逗号
 */
export function addCommasToNumber(number: number | string): string {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 格式化时间戳
 */
export function formatTime(time: number): string {
  return getFormatTimeStamp(time)
}

/**
 * 格式化日期
 */
export function formatDate(time: number, format = 'YYYY-MM-DD hh:mm'): string {
  return getSimpleDateFormatString({
    date: time,
    format,
  })
}

/**
 * 数字转换为索引字符串
 * @param number 数字
 * @param length 长度，默认3
 * @returns 补零后的索引字符串
 */
export function numberToIndex(number: number, length = 3): string {
  // 参数验证
  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new Error('numberToIndex: number 参数必须是整数')
  }

  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    throw new Error('numberToIndex: length 参数必须是正整数')
  }

  // 处理负数情况，转换为非负整数
  const absoluteNumber = Math.abs(number)
  const num = absoluteNumber + 1
  const numberString = num.toString()

  // 如果数字长度超过指定长度，截取后几位
  if (numberString.length > length) {
    return numberString.slice(-length)
  }

  // 如果数字长度等于指定长度，直接返回
  if (numberString.length === length) {
    return numberString
  }

  // 如果数字长度小于指定长度，前面补0
  return '0'.repeat(length - numberString.length) + numberString
}

/**
 * 千分位格式化
 */
export function formatThousand(number: number): string {
  return number.toLocaleString()
}

// 导出所有过滤器作为对象（兼容旧代码）
export const filters = {
  addCommasToNumber,
  formatTime,
  formatDate,
  numberToIndex,
  formatThousand,
} as const

export type GlobalFilters = typeof filters