import service from '../../config'
import { handleError } from '../../error-handler'
import type { RawDomainListResponse, ExclusiveDomainData, IndependentDomainData } from './types'

export const domainApi = {
  list(): Promise<RawDomainListResponse> {
    return service
      .get('/api/saas/domains')
      .then((res: any) => res.data)
      .catch(handleError)
  },
  createExclusive(data: ExclusiveDomainData) {
    return service.post('/api/saas/domains/exclusive', data).catch(handleError)
  },
  updateExclusive(domainId: number, data: ExclusiveDomainData) {
    return service.put(`/api/saas/domains/exclusive/${domainId}`, data).catch(handleError)
  },
  createIndependent(data: IndependentDomainData) {
    return service.post('/api/saas/domains/independent', data).catch(handleError)
  },
  updateIndependent(domainId: number, data: IndependentDomainData) {
    return service.put(`/api/saas/domains/independent/${domainId}`, data).catch(handleError)
  },
  deleteIndependent(domainId: number) {
    return service.delete(`/api/saas/domains/independent/${domainId}`).catch(handleError)
  },
  checkIsDomainExists(subdomain: string) {
    return service
      .get(`/api/saas/domains/check?subdomain=${subdomain}`)
      .then((res: any) => res.data)
      .catch((err: unknown) => {
        console.log(err)
        return undefined
      })
  },
}

export default domainApi
export * from './types'
