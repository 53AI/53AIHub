/**
 * 支付设置数据转换逻辑
 */
import { getSimpleDateFormatString } from '@km/shared-utils'
import { PAYMENT_TYPE, PAYMENT_TYPE_LABEL_MAP, type PaymentType } from '@/constants/payment'
import type {
  RawPaymentSetting,
  PaymentSetting,
  PaymentSettingListResponse,
  PaymentSettingMap,
} from './types'

export function transformPaymentSetting(rawItem: RawPaymentSetting): PaymentSetting {
  const item: any = { ...rawItem }

  item.pay_setting_id = +item.pay_setting_id || 0
  item.pay_type = +item.pay_type || 0

  item.pay_label = PAYMENT_TYPE_LABEL_MAP.get(item.pay_type as any) || 'payment.type.unknown'
  item.pay_status = !!+item.pay_status

  item.pay_config = item.pay_config || '{}'
  item.pay_config = typeof item.pay_config === 'string' ? JSON.parse(item.pay_config) : item.pay_config

  item.extra_config = item.extra_config || '{}'
  item.extra_config =
    typeof item.extra_config === 'string' ? JSON.parse(item.extra_config) : item.extra_config

  item.created_time = +item.created_time || 0
  if (item.created_time) item.created_time = getSimpleDateFormatString({ date: item.created_time })

  item.updated_time = +item.updated_time || 0
  if (item.updated_time) item.updated_time = getSimpleDateFormatString({ date: item.updated_time })

  return item as PaymentSetting
}

export function transformPaymentSettingList(rawData: PaymentSettingListResponse): PaymentSetting[] {
  const { pay_settings = [] } = rawData
  return pay_settings.map(transformPaymentSetting)
}

function getDefaultPaymentSetting(payType: PaymentType): PaymentSetting {
  const label = PAYMENT_TYPE_LABEL_MAP.get(payType)
  return {
    pay_setting_id: 0,
    pay_type: payType,
    pay_label: label || '',
    pay_status: false,
    pay_config: {},
    extra_config: {},
    created_time: '',
    updated_time: '',
  }
}

export function transformToPaymentSettingMap(paymentSettings: PaymentSetting[]): PaymentSettingMap {
  const map: PaymentSettingMap = {
    wechat: getDefaultPaymentSetting(PAYMENT_TYPE.WECHAT),
    alipay: getDefaultPaymentSetting(PAYMENT_TYPE.ALIPAY),
    manual: getDefaultPaymentSetting(PAYMENT_TYPE.MANUAL),
    paypal: getDefaultPaymentSetting(PAYMENT_TYPE.PAYPAL),
  }

  paymentSettings.forEach(setting => {
    switch (setting.pay_type) {
      case PAYMENT_TYPE.WECHAT:
        map.wechat = setting
        break
      case PAYMENT_TYPE.ALIPAY:
        map.alipay = setting
        break
      case PAYMENT_TYPE.MANUAL:
        map.manual = setting
        break
      case PAYMENT_TYPE.PAYPAL:
        map.paypal = setting
        break
    }
  })

  return map
}

export function prepareSavePaymentSettingData(data: any) {
  const preparedData: any = {
    pay_setting_id: 0,
    pay_config: {},
    extra_config: {},
    pay_status: true,
    pay_type: PAYMENT_TYPE.WECHAT,
    ...data,
  }

  const { pay_setting_id } = preparedData
  delete preparedData.pay_setting_id

  preparedData.pay_config = JSON.stringify(preparedData.pay_config || {})
  preparedData.extra_config = JSON.stringify(preparedData.extra_config || {})

  return { preparedData, pay_setting_id }
}

