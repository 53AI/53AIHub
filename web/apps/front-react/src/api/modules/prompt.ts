import service from '../config'
import { handleError } from '../errorHandler'

export const promptApi = {
  async list(params?: { keyword?: string; group_id?: string; offset?: number; limit?: number }) {
    return service
      .get('/api/prompts', { params: { offset: 0, limit: 1000, ...params } })
      .then((res) => res.data)
      .catch(handleError)
  },

  async get(prompt_id: string | number) {
    return service
      .get(`/api/prompts/${prompt_id}`)
      .then((res) => res.data)
      .catch(handleError)
  },

  async approve(prompt_id: string | number) {
    return service.patch(`/api/prompts/${prompt_id}/like`).catch(handleError)
  },

  async detail({ prompt_id }: { prompt_id: number | string }) {
    return service
      .get(`/api/prompts/${prompt_id}`)
      .then((res) => res.data)
      .catch(handleError)
  }
}

export default promptApi

