import type { IAgentApi } from '@km/shared-business'
import request from '../utils/request'

function parseJsonField(value: any, defaultValue: any) {
  if (!value) return defaultValue
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return defaultValue
  }
}

function formatAgentData(data: any = {}): any {
  data.user_group_ids = parseJsonField(data.user_group_ids, [])
  data.user_group_ids = [...new Set(data.user_group_ids as number[])]
  data.tools = parseJsonField(data.tools, [])
  data.use_cases = parseJsonField(data.use_cases, [])
  data.configs = parseJsonField(data.configs, {})
  data.custom_config = parseJsonField(data.custom_config, {})
  data.custom_config_obj = data.custom_config
  data.settings = parseJsonField(data.settings, {})
  data.settings_obj = data.settings
  data.enable = !!+(data.enable ?? false)
  data.sort = +(data.sort ?? 0)
  return data
}

export const agentAgentApi: IAgentApi = {
  detail(_agentId: number): Promise<any> {
    return Promise.reject(new Error('Not implemented - use getH5Info instead'))
  },

  list(): Promise<any> {
    return request.get('/api/agents', { params: { requiresAuth: true } })
  },

  myDetail(_agentId: number): Promise<any> {
    return Promise.reject(new Error('Not implemented'))
  },

  myList(): Promise<any> {
    return Promise.reject(new Error('Not implemented'))
  },

  async getH5Info(fixedToken: string): Promise<any> {
    const res: any = await request.post('/api/agents/h5/info', {
      fixed_token: fixedToken
    })
    if (res?.code === 0 && res?.data) {
      return formatAgentData(res.data)
    }
    throw new Error(res?.message || '获取智能体信息失败')
  },
}
