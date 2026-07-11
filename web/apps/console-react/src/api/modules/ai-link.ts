import service from '../config'
import { handleError } from '../error-handler'

export function getFormatAiLinkData(data: any = {}) {
  data.ai_link_id = data.id ?? ''
  return data
}

export const aiLinkApi = {
  async list({
    params = {},
    paramsSerializer,
  }: {
    params?: { group_id?: number[]; keyword?: string }
    paramsSerializer?: (params: any) => string
  } = {}) {
    const p = { ...params }
    if (!p.group_id || p.group_id.length === 0 || p.group_id.some(id => id < 0)) delete p.group_id
    if (!p.keyword) delete p.keyword
    const res = await service
      .get('/api/ai_links', { params: p, paramsSerializer })
      .catch(handleError) as any
    const data = res?.data ?? []
    return (Array.isArray(data) ? data : []).map((item: any) => getFormatAiLinkData(item))
  },
  async save({ data = {} }: { data?: any } = {}) {
    const d = {
      ai_link_id: '',
      logo: '',
      name: '',
      url: '',
      description: '',
      group_id: 0,
      sort: 0,
      user_group_ids: [],
      subscription_group_ids: [],
      shared_account: '',
      ...data,
    }
    const ai_link_id = d.ai_link_id
    delete d.ai_link_id
    const res = await service[ai_link_id ? 'put' : 'post'](
      `/api/ai_links${ai_link_id ? `/${ai_link_id}` : ''}`,
      d,
    ).catch(handleError) as any
    const resultData = res?.data ?? res ?? {}
    return getFormatAiLinkData(resultData)
  },
  delete({ data: { ai_link_id } }: { data: { ai_link_id: string } }) {
    return service.delete(`/api/ai_links/${ai_link_id}`).catch(handleError)
  },
  store() {
    return service.get('/api/ai_links/default').catch(handleError)
  },
  sort({ items = [] }: { items?: { group_id: number; id: string; sort: number }[] }) {
    return service.post('/api/ai_links/batch/sort', { items }).catch(handleError)
  },
  detail(id: string) {
    return service.get(`/api/ai_links/${id}`).catch(handleError)
  },
}

export default aiLinkApi
