import request from '../index'

export interface OrderListParams {
  status?: number
  pay_type?: number
  offset?: number
  keyword?: string
  limit?: number
  subscription?: number
  start_time?: number
  end_time?: number
}

export const ordersApi = {
  /**
   * 获取订单列表
   */
  list(params: OrderListParams = {}) {
    return request.get('/api/orders/me', { params })
  },

  /**
   * 关闭订单
   */
  close(order_id: string) {
    return request.post(`/api/orders/${order_id}/close`)
  }
}

export default ordersApi
