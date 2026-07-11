import service from '../config'
import { handleError } from '../error-handler'

export const wpsApi = {
  ticket(): Promise<{ ticket: string }> {
    return service
      .get('/api/wps/ticket')
      .then((res: any) => res.data)
      .catch(handleError)
  },
}

export default wpsApi

