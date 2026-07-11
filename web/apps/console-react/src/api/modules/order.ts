import service from '../config'
import { handleError } from '../error-handler'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { PAYMENT_TYPE, type PaymentType } from '@/constants/payment'

export const orderApi = {
  async list({
    params = {},
  }: {
    params?: {
      status?: number
      pay_type?: number
      keyword?: string
      offset?: number
      limit?: number
    }
  } = {}) {
    const p = { ...params }
    if (!p.offset) p.offset = 0
    if (!p.limit) p.limit = 10
    if (!p.keyword) delete p.keyword
    const res = await service.get('/api/orders', { params: p }).catch(handleError) as any
    const data = res?.data ?? {}
    const list = (data.orders || []).map((item: any) => {
      item.created_time = item.created_time
        ? getSimpleDateFormatString({ date: +item.created_time, format: 'YYYY-MM-DD hh:mm:ss' })
        : ''
      return item
    })
    return { ...data, list }
  },
  async detail(params: { id: number }) {
    const id = params.id ?? ''
    return service.get(`/api/orders/${id}`).catch(handleError)
  },
  async confirm_order(data: { id: number }) {
    const id = data.id ?? ''
    return service.post(`/api/orders/${id}/confirm`).catch(handleError)
  },
  async delete_order(data: { id: number }) {
    const id = data.id ?? ''
    return service.delete(`/api/orders/${id}`).catch(handleError)
  },
  async save(data: {
    id?: number
    pay_type?: PaymentType
    user_id: number
    nickname: string
    subscription_id: number
    subscription_name: string
    time_unit: string
    duration: number
    currency: string
    amount: number
  }) {
    const d = { ...data }
    const id = d.id ?? ''
    delete (d as any).id
    if (!d.pay_type) (d as any).pay_type = PAYMENT_TYPE.MANUAL
    return service[(id ? 'put' : 'post') as 'post'](
      `/api/orders${id ? `/${id}/manual` : ''}`,
      d,
    ).catch(handleError)
  },
}

export default orderApi
