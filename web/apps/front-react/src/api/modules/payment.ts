import request from '../index'

export const paymentApi = {
  /**
   * 获取可用的支付方式列表
   */
  async getAvailableList() {
    const { data = {} } = await request.get('/api/payment/available')
    return data
  },

  /**
   * 获取支付配置
   */
  async getPaymentConfig() {
    const { data = {} } = await request.get('/api/pay_settings')
    return data
  }
}

export default paymentApi
