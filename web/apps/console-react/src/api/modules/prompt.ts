import service from '../config'
import { handleError } from '../error-handler'

export const promptApi = {
  async list({
    params = {},
  }: {
    params: {
      keyword?: string
      group_id?: string
      offset?: number
      limit?: number
    }
  } = { params: {} }) {
    const cleanParams = JSON.parse(JSON.stringify(params))
    const res: any = await service.get('/api/prompts/admin', { params: cleanParams }).catch(handleError)
    const data = res?.data ?? {}
    const count = data.count ?? 0
    const prompts = data.prompts ?? []
    return { total: +count || 0, list: prompts }
  },
  async detail({ prompt_id }: { prompt_id: number }) {
    const res: any = await service.get(`/api/prompts/${prompt_id}`).catch(handleError)
    return res?.data ?? {}
  },
  async save(data: {
    prompt_id?: string
    group_ids?: (string | number)[]
    logo?: string
    name?: string
    description?: string
    content?: string
    subscription_group_ids?: (string | number)[]
    user_group_ids?: (string | number)[]
    sort?: number
    status?: 0 | 1 | undefined
    custom_config?: any
    ai_links?: any[]
  }) {
    const d: any = { ...data }
    const prompt_id = +d.prompt_id || 0
    delete d.prompt_id
    if (d.custom_config && typeof d.custom_config === 'object') d.custom_config = JSON.stringify(d.custom_config)
    if (!d.content) d.content = ' '
    const res: any = await service[(prompt_id ? 'put' : 'post') as 'post'](
      `/api/prompts/${prompt_id ? `${prompt_id}` : 'system'}`,
      d,
    ).catch(handleError)
    return res?.data ?? res ?? {}
  },
  async delete({ prompt_id }: { prompt_id: number }) {
    return service.delete(`/api/prompts/${prompt_id}`).catch(handleError)
  },
  async update_status({ prompt_id, status }: { prompt_id: number; status: 0 | 1 }) {
    return service.patch(`/api/prompts/${prompt_id}/status`, { status }).catch(handleError)
  },
}

export default promptApi

