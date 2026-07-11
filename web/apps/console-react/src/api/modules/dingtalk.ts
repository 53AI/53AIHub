import service from '../config'
import { handleError } from '../error-handler'

export const dingtalkApi = {
  /**
   * 发起钉钉OAuth2授权，对接调试用，实际授权需要在体验企业点击授权
   * @param redirect_uri 授权成功后跳转的URL
   */
  dingtalkOauth2(params: { redirect_uri: string }) {
    return service
      .get('/api/saas/dingtalk/oauth2/start', {
        params: { ...params, access_token: localStorage.getItem('access_token') },
      })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  // 钉钉成员搜索
  contact_search(data: { keyword: string }) {
    return service
      .post('/api/saas/dingtalk/contact-search', {
        offest: 0,
        query_word: data.keyword,
        size: 0,
      })
      .then((res: any) => res.data?.list ?? [])
      .catch(handleError)
  },
}

export default dingtalkApi

