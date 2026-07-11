import request from '../index'
import { PAYMENT_TYPE, TIME_UNIT, type PaymentType, type TimeUnitType } from '@/constants/payment'
import { CURRENCY_TYPE, getCurrencySymbol, type CurrencyType } from '@/constants/currency'
import { md5 } from '@km/shared-utils'

interface OrderCacheData {
  order_id?: number
  payment_expired_time?: number
  [key: string]: any
}

interface OrderParams {
  user_id: number
  nickname: string
  subscription_id: number
  subscription_name: string
  pay_type: PaymentType
  amount: number
  currency: CurrencyType
  duration: number
  time_unit: TimeUnitType
  return_url?: string
}

interface SubscriptionItem {
  group_id: number
  group_name: string
  logo_url: string
  is_default: boolean
  sort: number
  ai_enabled: boolean
  agents: any[]
  relations: any[]
  year_info: {
    amount: string
    currency: CurrencyType
    currency_symbol: string
    relation_id: number
    time_unit: TimeUnitType
    type: number
  }
  month_info: {
    amount: string
    currency: CurrencyType
    currency_symbol: string
    relation_id: number
    time_unit: TimeUnitType
    type: number
  }
  credit_month_info: {
    amount: string
    currency: string
    currency_symbol: string
    relation_id: number
    time_unit: TimeUnitType
    type: number
  }
  [key: string]: any
}

export const getOrderCache = ({ key = '' } = {}): OrderCacheData => {
  const temporary_order_data = JSON.parse(localStorage.getItem('temporary_order_data') || '{}')
  const order_data = temporary_order_data[key]
  if (!order_data) return temporary_order_data
  if (
    !Number(order_data.payment_expired_time) ||
    Number(order_data.payment_expired_time) < Date.now()
  ) {
    setOrderCache({ key, value: {} })
    return {}
  }
  return order_data
}

export const setOrderCache = ({ key = '', value = {} } = {}) => {
  const temporary_order_data = getOrderCache()
  temporary_order_data[key] = value
  localStorage.setItem('temporary_order_data', JSON.stringify(temporary_order_data))
}

let subscription_list: SubscriptionItem[] = []

export const subscriptionApi = {
  async list({ reset = false } = {}): Promise<{ count: number; list: SubscriptionItem[] }> {
    if (reset) subscription_list = []
    if (subscription_list.length) {
      return { count: subscription_list.length, list: subscription_list }
    }

    try {
      const { data: { count = 0, settings = [] } = {} } = await request.get('/api/subscriptions/settings')
      subscription_list = settings.map((item: any = {}, index: number) => {
        item.group = item.group || {}
        item.setting = item.setting || {}
        item = {
          ...item,
          ...item.group,
          ...item.setting
        }
        item.logo = item.logo || item.setting.logo_url || ''
        item.delete = Boolean(item.delete) || false
        item.group_id = item.group_id || 0
        item.setting_id = item.setting_id || 0
        item.sort = item.sort || settings.length - index || 0
        item.group_name = item.group_name || ''
        item.logo_url = item.logo_url || ''
        item.ai_enabled = Boolean(item.ai_enabled) || false
        item.relations = item.relations || []

        // 处理年度信息
        item.year_info = JSON.parse(
          JSON.stringify(
            item.relations.find(
              (row: any = {}) => row.type == 1 && row.time_unit === TIME_UNIT.YEAR
            ) || {}
          )
        )
        item.year_info.amount = (Number(item.year_info.amount || 0) / 100)
          .toFixed(2)
          .replace('.00', '')
        item.year_info.currency = item.year_info.currency || CURRENCY_TYPE.CNY
        item.year_info.currency_symbol = getCurrencySymbol(item.year_info.currency)
        item.year_info.relation_id = item.year_info.relation_id || 0
        item.year_info.time_unit = item.year_info.time_unit || TIME_UNIT.YEAR
        item.year_info.type = item.year_info.type || 1

        // 处理月度信息
        item.month_info = JSON.parse(
          JSON.stringify(
            item.relations.find(
              (row: any = {}) => row.type == 1 && row.time_unit === TIME_UNIT.MONTH
            ) || {}
          )
        )
        item.month_info.amount = (Number(item.month_info.amount || 0) / 100)
          .toFixed(2)
          .replace('.00', '')
        item.month_info.currency = item.month_info.currency || CURRENCY_TYPE.CNY
        item.month_info.currency_symbol = getCurrencySymbol(item.month_info.currency)
        item.month_info.relation_id = item.month_info.relation_id || 0
        item.month_info.time_unit = item.month_info.time_unit || TIME_UNIT.MONTH
        item.month_info.type = item.month_info.type || 1

        // 处理信用月度信息
        item.credit_month_info = JSON.parse(
          JSON.stringify(item.relations.find((row: any = {}) => row.type == 2) || {})
        )
        item.credit_month_info.amount = Number(item.credit_month_info.amount || 0)
          .toFixed(2)
          .replace('.00', '')
        item.credit_month_info.currency = item.credit_month_info.currency || ''
        item.credit_month_info.currency_symbol = getCurrencySymbol(item.credit_month_info.currency)
        item.credit_month_info.relation_id = item.credit_month_info.relation_id || 0
        item.credit_month_info.time_unit = item.credit_month_info.time_unit || TIME_UNIT.MONTH
        item.credit_month_info.type = item.credit_month_info.type || 2

        item.agents = item.agents || []
        return item
      })

      return {
        count,
        list: subscription_list
      }
    } catch(e) {
      return {
        count: 0,
        list: []
      }
    }

  },

  getFormatOrderData(data: any = {}) {
    data.order = data.order || {}
    data.payment_info = data.payment_info || {}
    data = {
      ...data,
      ...data.order,
      ...data.payment_info
    }
    data.order_id = +data.order.id || 0
    data.payment_expired_time = +data.payment_info.expired_time || 0
    if (data.payment_expired_time) data.payment_expired_time -= 1000 * 60 * 10
    data.payment_order_id = data.payment_info.order_id || 0
    return data
  },

  async createOrder({
    params = {},
    cache_disabled = false
  }: {
    params?: Partial<OrderParams>
    cache_disabled?: boolean
  } = {}): Promise<any> {
    const defaultParams: OrderParams = {
      user_id: 0,
      nickname: '',
      subscription_id: 0,
      subscription_name: '',
      pay_type: PAYMENT_TYPE.WECHAT,
      amount: 0,
      currency: CURRENCY_TYPE.CNY,
      duration: 0,
      time_unit: TIME_UNIT.MONTH
    }

    const mergedParams = { ...defaultParams, ...params } as OrderParams
    const isAlipay = mergedParams.pay_type === PAYMENT_TYPE.ALIPAY
    if (isAlipay) {
      mergedParams.return_url = window.location.href
    }
    const storage_key = md5(JSON.stringify(mergedParams))

    if (!cache_disabled) {
      const order_data = getOrderCache({ key: storage_key })
      if (order_data && +order_data.order_id > 0) return order_data
    }

    let { data = {} } = await request.post('/api/orders', mergedParams)
    if (isAlipay) {
      window.location.href = data.payment_info.returnUrl
      return true
    }
    data = subscriptionApi.getFormatOrderData(data)

    if (!cache_disabled) {
      setOrderCache({ key: storage_key, value: data })
    }

    return data
  },

  async getOrderStatus(params: { order_id: string }): Promise<any> {
    const { data = {} } = await request.get(`/api/orders/status/${params.order_id}`)
    return data
  }
}

export default subscriptionApi
