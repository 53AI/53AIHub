import service from '../config'
import { handleError } from '../errorHandler'
import { AGENT_TYPES, AGENT_MODES, BACKEND_AGENT_TYPE, getAgentByAgentType } from '@/constants/platform'

export { AGENT_TYPES, AGENT_MODES, BACKEND_AGENT_TYPE }

export type AgentType = string

export interface AgentData {
  user_group_ids?: string | number[]
  tools?: string | any[]
  use_cases?: string | any[]
  configs?: string | Record<string, any>
  custom_config?: string | {
    agent_type?: string
    channel_config?: Record<string, any>
  }
  backend_agent_type?: number
  agent_type?: string
  agent_type_label?: string
  channel_type?: number
  enable?: boolean | number | string
  sort?: number | string
  channel_config?: Record<string, any>
  agents?: AgentData[]
  count?: number
  settings?: Record<string, any>
}

interface ListParams {
  offset?: number
  limit?: number
  keyword?: string
  group_id?: string
  channel_types?: string
  agent_types?: string
}

interface SaveParams {
  agent_id?: number | string
  bot_id?: string
  channel_type?: number
  group_id?: number
  configs?: Record<string, any> | string
  logo?: string
  name?: string
  description?: string
  model?: string
  prompt?: string
  sort?: number
  tools?: any[] | string
  use_cases?: any[] | string
  user_group_ids?: number[]
  custom_config?: Record<string, any> | string
  settings?: Record<string, any> | string
  enable?: boolean
}

interface SaveRequestData extends Omit<SaveParams, 'configs' | 'tools' | 'use_cases' | 'custom_config'> {
  configs: string
  tools: string
  use_cases: string
  custom_config: string
  settings: string
}

export interface RawCozeWorkspaceItem {
  id: string
  name: string
  icon_url: string
  role_type: string
  workspace_type: string
}

export interface CozeWorkspaceItem extends RawCozeWorkspaceItem {
  value: string
  label: string
  icon: string
}

export interface Raw53aiBotItem {
  bot_id: string
  name: string
  logo: string
  description: string
  opening_statement: string
  suggested_questions: string[]
}

export interface RawCozeBotItem {
  bot_id: string
  bot_name: string
  description: string
  icon_url: string
}

export interface RawTencentAppItem {
  AppType: string
  AppTypeDesc: string
  AppBizId: string
  Name: string
  Avatar: string
  Desc: string
  AppStatus: number
  AppStatusDesc: string
  UpdateTime: string
  Operator: string
  ModelAliasName: string
  Pattern: string
  ThoughtModelAliasName: string
  PermissionIds: string[]
  Creator: string
}

export interface CozeBotItem extends RawCozeBotItem {
  value: string
  label: string
  icon: string
}

export interface RawAppBuilderBotItem {
  id: string
  name: string
  description: string
  appType: string
  isPublished: boolean
  updateTime: number
}

export interface AppBuilderBotItem extends RawAppBuilderBotItem {
  value: string
  label: string
  icon: string
}

export interface BotItem53aiItem extends Raw53aiBotItem {
  value: string
  label: string
  icon: string
}

export interface TencentAppItem extends RawTencentAppItem {
  value: string
  label: string
  icon: string
  description: string
}

export const transformCozeBotItem = (item: RawCozeBotItem): CozeBotItem => {
  return {
    ...item,
    value: item.bot_id,
    label: item.bot_name,
    icon: item.icon_url,
  }
}

export const transformAppBuilderBotItem = (item: RawAppBuilderBotItem): AppBuilderBotItem => {
  return {
    ...item,
    value: item.id,
    label: item.name,
    icon: getAgentByAgentType(AGENT_TYPES.APP_BUILDER)?.icon || '',
  }
}

export const transformCozeWorkspaceItem = (item: RawCozeWorkspaceItem): CozeWorkspaceItem => {
  return {
    ...item,
    value: item.id,
    label: item.name,
    icon: item.icon_url,
  }
}

export const transform53aiBotItem = (item: Raw53aiBotItem): BotItem53aiItem => {
  return {
    ...item,
    value: item.bot_id,
    label: item.name,
    icon: item.logo,
  }
}

export const transformTencentAppItem = (item: RawTencentAppItem): TencentAppItem => {
  return {
    ...item,
    value: item.AppBizId,
    label: item.Name,
    icon: item.Avatar,
    description: item.Desc,
  }
}

const parseJsonField = <T>(value: string | T, defaultValue: T): T => {
  if (typeof value !== 'string') return value ?? defaultValue
  try {
    return JSON.parse(value) ?? defaultValue
  } catch {
    return defaultValue
  }
}

export function getFormatAgentData(data: AgentData = {}): AgentData {
  data.user_group_ids = parseJsonField(data.user_group_ids, [])
  data.user_group_ids = [...new Set(data.user_group_ids as number[])]
  data.tools = parseJsonField(data.tools, [])
  data.use_cases = parseJsonField(data.use_cases, [])
  data.configs = parseJsonField(data.configs, {})
  data.custom_config = parseJsonField(data.custom_config, {})
  data.settings = parseJsonField(data.settings, {})
  data.backend_agent_type = data.agent_type || BACKEND_AGENT_TYPE.AGENT
  data.agent_type = (data.custom_config as any)?.agent_type || AGENT_TYPES.PROMPT
  data.agent_type_label = `agent_app.${data.agent_type}`
  data.enable = !!+(data.enable ?? false)
  data.sort = +(data.sort ?? 0)
  data.channel_config = (data.custom_config as any)?.channel_config || {}
  return data
}

const agentApi = {
  async list({ params = {} as ListParams }: { params: ListParams } = { params: {} }): Promise<AgentData> {
    params = JSON.parse(JSON.stringify(params))
    params.offset = params.offset ?? 0
    params.limit = params.limit ?? 10
    params.group_id = !params.group_id || +params.group_id < 1 ? '0' : params.group_id
    if (!params.keyword) delete params.keyword
    if (!params.channel_types) delete params.channel_types

    const { data = {} } = await service.get('/api/agents/group', { params }).catch(handleError)
    const result = data as AgentData
    result.agents = (result.agents || []).map(item => getFormatAgentData(item))
    result.count = +(result.count ?? 0)
    return result
  },

  async save({ data = {} as SaveParams } = {}): Promise<AgentData> {
    const saveData: SaveParams = {
      agent_id: 0,
      channel_type: 0,
      group_id: 0,
      configs: {},
      logo: '',
      name: '',
      description: '',
      model: '',
      prompt: '',
      sort: 0,
      tools: [],
      use_cases: [],
      user_group_ids: [],
      custom_config: {},
      settings: {},
      enable: true,
      ...data,
    }

    // 判断是否有有效的 agent_id（支持 number 或 string 类型）
    const hasAgentId = saveData.agent_id && saveData.agent_id !== 0 && saveData.agent_id !== '0'
    const agent_id = hasAgentId ? saveData.agent_id : undefined
    delete saveData.agent_id

    const requestData: SaveRequestData = {
      ...saveData,
      configs: typeof saveData.configs === 'object' ? JSON.stringify(saveData.configs) : saveData.configs as string,
      tools: Array.isArray(saveData.tools) ? JSON.stringify(saveData.tools) : saveData.tools as string,
      use_cases: Array.isArray(saveData.use_cases) ? JSON.stringify(saveData.use_cases) : saveData.use_cases as string,
      custom_config: typeof saveData.custom_config === 'object' ? JSON.stringify(saveData.custom_config) : saveData.custom_config as string,
      settings: typeof saveData.settings === 'object' ? JSON.stringify(saveData.settings) : saveData.settings as string,
    }

    if (typeof requestData.enable === 'undefined') requestData.enable = true

    const { data: result = {} } = await service[agent_id ? 'put' : 'post'](`/api/agents${agent_id ? `/${agent_id}` : ''}`, requestData).catch(handleError)
    return getFormatAgentData(result)
  },

  async delete({ data: { agent_id } }: { data: { agent_id: string } }) {
    return service.delete(`/api/agents/${agent_id}`).catch(handleError)
  },

  async detail({ data: { agent_id } }: { data: { agent_id: number | string } }) {
    const { data = {} } = await service.get(`/api/agents/${agent_id}`).catch(handleError)
    return getFormatAgentData(data)
  },

  coze: {
    workspaces_list(params?: { provider_id?: number }): Promise<RawCozeWorkspaceItem[]> {
      return service.get('/api/coze/workspaces', { params }).then(res => res.data).catch(handleError)
    },
    bots_list(workspace_id: string, params?: { provider_id?: number }): Promise<RawCozeBotItem[]> {
      return service.get(`/api/coze/workspaces/${workspace_id}/bots`, { params }).then(res => res.data || []).catch(handleError)
    },
  },

  appbuilder: {
    bots_list(params?: { provider_id?: number }): Promise<RawAppBuilderBotItem[]> {
      return service.get('/api/appbuilder/bots', { params }).then(res => res.data || []).catch(handleError)
    },
  },

  chat53ai: {
    bots_list(params?: { provider_id?: number }) {
      return service.get('/api/53ai/bots', { params }).then(res => res.data).catch(handleError)
    },
    workflow_list(params?: { provider_id?: number }) {
      return service.get('/api/53ai/workflows', { params }).then(res => res.data).catch(handleError)
    },
    workflow_field_list(botId: string, params?: { provider_id?: number }) {
      return service.get(`/api/53ai/parameters/${botId}`, { params }).then(res => res.data).catch(handleError)
    },
  },

  dify: {
    workflow_field_list(workflow_id: string) {
      return service.get(`/api/dify/parameters/${workflow_id}`).then(res => res.data).catch(handleError)
    },
  },

  tencent: {
    bots_list(params?: { provider_id?: number }) {
      return service.get('/api/tencent/apps', { params }).then(res => res.data).catch(handleError)
    },
    detail(app_biz_id: string) {
      return service.get(`/api/tencent/apps/${app_biz_id}`).then(res => res.data).catch(handleError)
    },
  },

  providers: {
    list(params?: { provider_type?: number }) {
      return service.get('/api/providers', { params }).then(res => res.data || []).catch(handleError)
    },
  },

  async updateStatus({ data: { agent_id, enable } }: { data: { agent_id: string; enable: boolean } }) {
    return service.patch(`/api/agents/${agent_id}/status`, { enable }).catch(handleError)
  },
}

export default agentApi
