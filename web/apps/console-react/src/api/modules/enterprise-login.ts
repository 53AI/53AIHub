import service from '../config';
import { handleError } from '../error-handler';

/**
 * 登录页相关的企业 SaaS 接口（对齐 Vue Console 的 enterprise 模块登录相关部分）
 */

export const enterpriseLoginApi = {
  saas_list(params: { status?: -1 | 0 | 1 | 2; offset?: number; limit?: number }) {
    const { status = -1, offset = 0, limit = 500 } = params || {}
    return service
      .get('/api/saas/enterprise/applies', {
        params: { status, offset, limit },
      })
      .catch(handleError)
  },

  saas_apply(data: {
    contact_name: string
    enterprise_name: string
    domain: string
    email: string
    phone: string
  }) {
    return service.post('/saas/enterprise/apply', data).catch(handleError)
  },

  saas_detail(eid: string) {
    return service
      .get(`/api/saas/enterprise/${eid}`, {
        headers: {
          'X-My-Id': eid,
        },
      })
      .catch(handleError)
  },
}

export default enterpriseLoginApi

