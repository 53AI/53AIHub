import service from '../config'
import { handleError } from '../errorHandler'

interface WebSearchSettings {
  enabled: boolean
  api_key: string
  base_url: string
}

export const platformApi = {
  async getWebSearchSettings(): Promise<WebSearchSettings> {
    const res = await service.get('/api/platform/web-search/settings').catch(handleError) as any
    return res?.data || {}
  },

  async saveWebSearchSettings(data: WebSearchSettings): Promise<void> {
    return service.post('/api/platform/web-search/settings', data).catch(handleError)
  },
}

export default platformApi