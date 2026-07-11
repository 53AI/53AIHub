import service from '../config'
import { handleError } from '../error-handler'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { PROVIDER_VALUE, type ProviderValueType } from '@/constants/platform'

export const providerApi = {
  async list({
    params = {},
  }: {
    params?: { providerType?: ProviderValueType }
  } = {}) {
    const p = { ...params }
    const res = await service.get('/api/providers', { params: p }).catch(handleError) as any
    const data = res?.data ?? []
    return (Array.isArray(data) ? data : []).map((item: any) => {
      try {
        item.configs =
          typeof item.configs === 'string' ? JSON.parse(item.configs) : item.configs || {}
      } catch {
        item.configs = {}
      }
      item.created_time = item.created_time
        ? getSimpleDateFormatString({ date: item.created_time })
        : ''
      item.updated_time = item.updated_time
        ? getSimpleDateFormatString({ date: item.updated_time })
        : ''
      item.authed_time = item.authed_time
        ? getSimpleDateFormatString({ date: item.authed_time })
        : ''
      if (
        item.provider_type === PROVIDER_VALUE.APP_BUILDER ||
        item.provider_type === PROVIDER_VALUE['53AI'] ||
        item.provider_type === PROVIDER_VALUE.COZE_OSV
      ) {
        item.authed_time = item.created_time
      }
      return item
    })
  },
  async save({ data }: { data?: any } = {}) {
    const d = {
      provider_type: PROVIDER_VALUE.COZE_CN,
      provider_id: 0,
      name: '',
      access_token: '',
      configs: {},
      ...data,
    }
    const provider_id = d.provider_id
    delete d.provider_id
    if (typeof d.configs === 'object') d.configs = JSON.stringify(d.configs)
    const res = await service[(provider_id ? 'put' : 'post') as 'post'](
      `/api/providers${provider_id ? `/${provider_id}` : ''}`,
      d,
    ).catch(handleError) as any
    return res?.data ?? res ?? {}
  },
  async delete({ data: { provider_id } }: { data: { provider_id: number } }) {
    return service.delete(`/api/providers/${provider_id}`).catch(handleError)
  },
}

export default providerApi
