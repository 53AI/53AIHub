import service from '../config'
import { handleError } from '../error-handler'

export const licenseApi = {
  features() {
    return service.get('/api/license/features').catch(handleError)
  },
  status() {
    return service.get('/api/license/status').catch(handleError)
  },
}

export default licenseApi

