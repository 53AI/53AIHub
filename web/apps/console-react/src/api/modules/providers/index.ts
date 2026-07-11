import service from '../../config'
import { handleError } from '../../error-handler'
import type { ProviderValueType } from '@/constants/platform'
import type { ProviderCreateRequest, ProviderUpdateRequest, RawProviderItem } from './types'

const providersApi = {
  list(params?: { providerType?: ProviderValueType; name?: string }): Promise<RawProviderItem[]> {
    return service
      .get('/api/providers', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  create(data: ProviderCreateRequest): Promise<RawProviderItem> {
    return service
      .post('/api/providers', data)
      .then((res: any) => res.data)
      .catch(handleError)
  },

  update(provider_id: RawProviderItem['provider_id'], data: ProviderUpdateRequest) {
    return service.put(`/api/providers/${provider_id}`, data).catch(handleError)
  },

  delete(provider_id: RawProviderItem['provider_id']) {
    return service.delete(`/api/providers/${provider_id}`).catch(handleError)
  },
}

export default providersApi
export * from './types'
export * from './transform'

