/**
 * 支付设置相关类型定义
 */

export type PaymentType = 1 | 2 | 3 | 4 | -1

export interface RawPaymentSetting {
  pay_setting_id: string | number
  pay_type: string | number
  pay_status: string | number
  pay_config: string | object
  extra_config: string | object
  created_time: string | number
  updated_time: string | number
}

export interface PaymentSetting {
  pay_setting_id: number
  pay_type: PaymentType
  pay_label: string
  pay_status: boolean
  pay_config: Record<string, any>
  extra_config: Record<string, any>
  created_time: string
  updated_time: string
}

export interface PaymentSettingListResponse {
  pay_settings: RawPaymentSetting[]
}

export interface SavePaymentSettingRequest {
  pay_setting_id: number
  pay_config: Record<string, any>
  extra_config?: Record<string, any>
  pay_status?: boolean
  pay_type: PaymentType
}

export interface UpdatePaymentStatusRequest {
  pay_status: boolean
}

export interface PaymentSettingMap {
  wechat: PaymentSetting
  alipay: PaymentSetting
  manual: PaymentSetting
  paypal: PaymentSetting
}

