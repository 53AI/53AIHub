export const ORDER_STATUS = {
  ALL: -1,
  NOT_CONFIRM: 1,
  PENDING: 2,
  PAID: 3,
  EXPIRED: 4,
  CANCELLED: 5
} as const

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

export const ORDER_STATUS_LABEL_MAP = new Map([
  [ORDER_STATUS.ALL, 'order.status.all'],
  [ORDER_STATUS.NOT_CONFIRM, 'order.status.not_confirm'],
  [ORDER_STATUS.PENDING, 'order.status.pending'],
  [ORDER_STATUS.PAID, 'order.status.paid'],
  [ORDER_STATUS.EXPIRED, 'order.status.expired'],
  [ORDER_STATUS.CANCELLED, 'order.status.cancelled']
])
