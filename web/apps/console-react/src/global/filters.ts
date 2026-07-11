import { getFormatTimeStamp, getSimpleDateFormatString } from '@km/shared-utils'

export const filters = {
  addCommasToNumber(number: number | string) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  },
  formatTime(time: number) {
    return getFormatTimeStamp(time)
  },
  formatDate(time: number, format = 'YYYY-MM-DD hh:mm') {
    return getSimpleDateFormatString({
      date: time,
      format,
    })
  },
  numberToIndex(number: number, length = 3) {
    if (typeof number !== 'number' || !Number.isInteger(number)) {
      throw new Error('numberToIndex: number 参数必须是整数')
    }
    if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
      throw new Error('numberToIndex: length 参数必须是正整数')
    }
    const absoluteNumber = Math.abs(number)
    const num = absoluteNumber + 1
    const numberString = num.toString()
    if (numberString.length > length) {
      return numberString.slice(-length)
    }
    if (numberString.length === length) {
      return numberString
    }
    return '0'.repeat(length - numberString.length) + numberString
  },
  formatSecret(secret: string) {
    if (!secret) return ''
    return `${secret.slice(0, 4)}****${secret.slice(-4)}`
  },
} as const

export type GlobalFilters = typeof filters

