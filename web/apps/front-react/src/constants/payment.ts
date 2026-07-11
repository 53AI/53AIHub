export const PAYMENT_TYPE = {
  WECHAT: 1,
  MANUAL: 2,
  PAYPAL: 3,
  ALIPAY: 4
} as const

export const PAYMENT_TYPE_LABEL_MAP: Record<PaymentType, string> = {
  [PAYMENT_TYPE.WECHAT]: 'subscription.wechat_pay',
  [PAYMENT_TYPE.MANUAL]: 'subscription.manual_pay',
  [PAYMENT_TYPE.PAYPAL]: 'subscription.paypal',
  [PAYMENT_TYPE.ALIPAY]: 'subscription.alipay'
}

/**
 * 支付类型
 */
export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE]

/**
 * 时间单位类型
 */
export const TIME_UNIT = {
  MONTH: 'month',
  YEAR: 'year'
} as const

export type TimeUnitType = (typeof TIME_UNIT)[keyof typeof TIME_UNIT]
