export const PAYMENT_TYPE = {
  ALL: -1,
  WECHAT: 1,
  MANUAL: 2,
  PAYPAL: 3,
  ALIPAY: 4,
} as const

export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE]

export const PAYMENT_TYPE_LABEL_MAP = new Map([
  [PAYMENT_TYPE.ALL, window.$t('payment.type.all')],
  [PAYMENT_TYPE.WECHAT, window.$t('payment.type.wechat')],
  [PAYMENT_TYPE.MANUAL, window.$t('payment.type.manual')],
  [PAYMENT_TYPE.PAYPAL, window.$t('payment.type.paypal')],
  [PAYMENT_TYPE.ALIPAY, window.$t('payment.type.alipay')],
])

export const PAYMENT_TYPE_ICON_MAP = new Map([
  [PAYMENT_TYPE.WECHAT, 'wechat'],
  [PAYMENT_TYPE.ALIPAY, 'alipay'],
  [PAYMENT_TYPE.MANUAL, 'manual-pay'],
  [PAYMENT_TYPE.PAYPAL, 'paypal'],
])

export const PAYMENT_TYPE_KEY_MAP = new Map([
  [PAYMENT_TYPE.WECHAT, 'wechat'],
  [PAYMENT_TYPE.ALIPAY, 'alipay'],
  [PAYMENT_TYPE.MANUAL, 'manual'],
  [PAYMENT_TYPE.PAYPAL, 'paypal'],
])

export const SUPPORTED_PAYMENT_TYPES = [
  PAYMENT_TYPE.WECHAT,
  PAYMENT_TYPE.ALIPAY,
  PAYMENT_TYPE.MANUAL,
  PAYMENT_TYPE.PAYPAL,
] as const

export const DEFAULT_PAYMENT_CONFIG = {
  pay_setting_id: 0,
  pay_config: {},
  extra_config: {},
  pay_status: true,
  pay_type: PAYMENT_TYPE.WECHAT,
} as const

export const PAYMENT_STATUS = {
  ENABLED: true,
  DISABLED: false,
} as const

export const PAYMENT_COMMAND = {
  SETTING: 'setting',
  ENABLE: 'enable',
  DISABLE: 'disable',
} as const

