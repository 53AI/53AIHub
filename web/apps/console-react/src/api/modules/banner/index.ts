import service from '../../config'
import { handleError } from '../../error-handler'

import type { Banner, RawBanner } from './types'

export const bannerApi = {
  get(): Promise<RawBanner> {
    return service
      .get('/api/enterprises/banner')
      .then((res: any) => res.data.banner)
      .catch(handleError)
  },
  async save(data: Banner) {
    return service
      .put('/api/enterprises/banner', { banner: JSON.stringify(data) })
      .catch(handleError)
  },
}

export default bannerApi
export * from './types'
export * from './transform'

