import service from '../config'
import { handleError } from '../error-handler'
import { suite_id } from '@/utils/config'

export const wecomApi = {
  jssdk_config(suite_id: string, params: { url: string }) {
    return service
      .get(`/api/saas/wecom/callback/jssdk-config/${suite_id}`, { params })
      .catch(handleError)
  },
  contact_search(data: { keyword: string }) {
    return service
      .post(`/api/saas/wecom/callback/contact-search/${suite_id}`, {
        limit: 10,
        query_word: data.keyword,
      })
      .catch(handleError)
  },
}

export default wecomApi

