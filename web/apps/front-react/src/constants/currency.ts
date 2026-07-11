export const CURRENCY_TYPE = {
  CNY: 'CNY',
  USD: 'USD',
  JPY: 'JPY',
  EUR: 'EUR',
  GBP: 'GBP'
} as const

export type CurrencyType = (typeof CURRENCY_TYPE)[keyof typeof CURRENCY_TYPE]

export const CURRENCY_SYMBOL_MAP = new Map<CurrencyType, string>([
  [CURRENCY_TYPE.CNY, '¥'],
  [CURRENCY_TYPE.USD, '$'],
  [CURRENCY_TYPE.JPY, '¥'],
  [CURRENCY_TYPE.EUR, '€'],
  [CURRENCY_TYPE.GBP, '£'],
])

/**
 * 获取货币符号
 */
export function getCurrencySymbol(currency: CurrencyType): string {
  return CURRENCY_SYMBOL_MAP.get(currency) || '¥'
}
