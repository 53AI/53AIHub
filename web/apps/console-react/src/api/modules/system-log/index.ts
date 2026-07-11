import service from '../../config'
import { handleError } from '../../error-handler'

import type {
  SystemLogListResponse,
  SystemLogListRequest,
  SystemLogCreateRequest,
  ActionItem,
  ModuleItem,
} from './types'

export const systemLogApi = {
  list(params: SystemLogListRequest): Promise<SystemLogListResponse> {
    return service
      .get('/api/system_logs', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },

  create(data: SystemLogCreateRequest) {
    return service.post('/api/users/system_log', data).catch(() => ({}))
  },

  actions(): Promise<ActionItem[]> {
    return service
      .get('/api/system_logs/actions')
      .then((res: any) => res.data)
      .catch(handleError)
  },

  modules(): Promise<ModuleItem[]> {
    return service
      .get('/api/system_logs/modules')
      .then((res: any) => res.data)
      .catch(handleError)
  },
}

export default systemLogApi
export * from './types'
export * from './transform'

