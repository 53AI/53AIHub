/**
 * 支付设置API接口
 * 只包含HTTP请求调用，业务逻辑在transform中处理
 */
import service from '../../config'
import { handleError } from '../../error-handler'
import type {
  PaymentSettingListResponse,
  SavePaymentSettingRequest,
  UpdatePaymentStatusRequest,
} from './types'

export const paymentApi = {
  getPaymentSettings(): Promise<PaymentSettingListResponse> {
    return service
      .get('/api/pay_settings')
      .then((res: any) => res.data)
      .catch(handleError)
  },

  savePaymentSetting(data: SavePaymentSettingRequest) {
    const { pay_setting_id, ...requestData } = data
    return pay_setting_id
      ? service
          .patch(`/api/pay_settings/${pay_setting_id}/config`, {
            pay_config: (requestData as any).pay_config,
            extra_config: (requestData as any).extra_config,
          })
          .catch(handleError)
      : service.post('/api/pay_settings', requestData).catch(handleError)
  },

  updatePaymentStatus(pay_setting_id: number, data: UpdatePaymentStatusRequest) {
    return service.patch(`/api/pay_settings/${pay_setting_id}/status`, data).catch(handleError)
  },
}

export default paymentApi
export * from './types'
export * from './transform'

