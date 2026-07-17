import service from '../../config'
<<<<<<<< HEAD:web/apps/front-react/src/api/modules/agents/index.ts
import { handleError } from '../../errorHandler'
import { MyAgentRequest } from './types'

export interface RawAgentInfo {
  agent_id: string
========
import { handleError } from '../../error-handler'

export interface RawAgentInfo {
  agent_id: string | number
>>>>>>>> origin/main:web/apps/console-react/src/api/modules/agents/index.ts
  eid: number
  name: string
  logo: string
  sort: number
  agent_usage: number
  description: string
  channel_type: number
  model: string
  prompt: string
  configs: string
  tools: string
  group_id: number
  use_cases: string
  created_by: number
  custom_config: string
  settings: string
  user_group_ids: number[]
  enable: boolean
  conversation_count: number
  agent_type: number
  created_time: number
  updated_time: number
}

export interface AgentInfo
  extends Omit<RawAgentInfo, 'settings' | 'tools' | 'use_cases' | 'custom_config' | 'configs'> {
  settings: Record<string, any>
  tools: Record<string, any>
  use_cases: Record<string, any>
  custom_config: Record<string, any>
  configs: Record<string, any>
}

interface AgentInfoResponse {
  agents: RawAgentInfo[]
  count: number
}

interface AgentInfoRequest {
  channel_type: number
  group_id: number
  configs: string
  logo: string
  name: string
  description: string
  model: string
  prompt: string
  sort: number
  tools: string
  use_cases: string
  user_group_ids: number[]
  custom_config: string
  settings: string
  enable: boolean
  agent_type: number
  subscription_group_ids: number[]
}

interface RawAgentModelInfo {
<<<<<<<< HEAD:web/apps/front-react/src/api/modules/agents/index.ts
  agent_id: string
========
  agent_id: string | number
>>>>>>>> origin/main:web/apps/console-react/src/api/modules/agents/index.ts
  channel_id: number
  channel_type: number
  created_time: number
  eid: number
  id: number
  model: string
  model_meta: {
    deep_thinking: boolean
  }
  updated_time: number
}

interface RawAgentModelRequest {
  channel_id: number
  channel_type: number
  model: string
}

interface AgentModelResponse {
  agent_models: RawAgentModelInfo[]
  count: number
}

const agentsApi = {
  group(params: {
    group_id: number
    keyword?: string
    offset?: number
    limit?: number
  }): Promise<AgentInfoResponse> {
    return service
      .get('/api/agents/group', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  list(params: {
    offset?: number
    limit?: number
    keyword?: string
    agent_usages?: string | number
  }): Promise<AgentInfoResponse> {
    return service
      .get('/api/agents', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  list(params: {
    keyword?: string
    offset?: number
    limit?: number
    agent_usages?: string
  }): Promise<AgentInfoResponse> {
    return service
      .get('/api/agents', { params, requiresAuth: true })
      .then(res => res.data)
      .catch(handleError)
  },
  /** 获取单个智能体详情 */
  detail(agent_id: string) {
    return service
      .get(`/api/agents/${agent_id}`)
      .then(res => res.data)
      .catch(handleError)
  },
  internalList() {
    return service.get(`/api/agents/internal_users`).catch(handleError)
  },
  available(params: {
    offset?: number
    limit?: number
  } = {}) {
    return service.get(`/api/agents/available`, { params }).catch(handleError)
  },
  create(data: AgentInfoRequest) {
    return service
      .post('/api/agents', data)
      .then((res: any) => res.data)
      .catch((err: any) => handleError(err, { functionName: window.$t('agent.name') }))
  },
  update(agent_id: RawAgentInfo['agent_id'], data: AgentInfoRequest) {
    return service
      .put(`/api/agents/${agent_id}`, data)
      .then((res: any) => res.data)
      .catch(handleError)
  },
<<<<<<<< HEAD:web/apps/front-react/src/api/modules/agents/index.ts
  models: {
    list(agent_id: RawAgentInfo['agent_id']): Promise<AgentModelResponse> {
      return service
        .get(`/api/agents/${agent_id}/models`, { requiresAuth: true })
        .then(res => res.data)
========
  delete(agent_id: RawAgentInfo['agent_id']) {
    return service.delete(`/api/agents/${agent_id}`).catch(handleError)
  },
  status(agent_id: RawAgentInfo['agent_id'], data: { enable: boolean }) {
    return service.patch(`/api/agents/${agent_id}/status`, data).catch(handleError)
  },
  models: {
    list(agent_id: RawAgentInfo['agent_id']): Promise<AgentModelResponse> {
      return service
        .get(`/api/agents/${agent_id}/models`)
        .then((res: any) => res.data)
        .catch(handleError)
    },
    batch(data: { agent_id: RawAgentInfo['agent_id']; models: RawAgentModelRequest[] }) {
      return service
        .post('/api/agents/models/batch', data)
        .then((res: any) => res.data)
>>>>>>>> origin/main:web/apps/console-react/src/api/modules/agents/index.ts
        .catch(handleError)
    },
    create(agent_id: RawAgentInfo['agent_id'], data: RawAgentModelRequest) {
      return service
        .get(`/api/agents/${agent_id}/models`, { params: data })
        .then((res: any) => res.data)
        .catch(handleError)
    },
    update(agent_id: RawAgentInfo['agent_id'], model_id: number, data: RawAgentModelRequest) {
      return service
        .put(`/api/agents/${agent_id}/models/${model_id}`, { params: data })
        .then((res: any) => res.data)
        .catch(handleError)
    },
    delete(agent_id: RawAgentInfo['agent_id'], model_id: number) {
      return service
        .delete(`/api/agents/${agent_id}/models/${model_id}`)
        .then((res: any) => res.data)
        .catch(handleError)
    },
  },
  h5: {
    getToken(agent_id: string | number): Promise<{ fixed_token: string; expires_at?: string }> {
      return service
        .get('/api/agents/h5/fixed-token', { params: { agent_id, limit: 1 } })
        .then((res: any) => {
          if (res?.data?.list?.length > 0) {
            return { fixed_token: res.data.list[0].token, expires_at: res.data.list[0].expires_at }
          }
          return null
        })
        .catch(handleError)
    },
    generateToken(agent_id: string | number): Promise<{ fixed_token: string; expires_at?: string }> {
      return service
        .post('/api/agents/h5/fixed-token', { agent_id })
        .then((res: any) => res.data)
        .catch(handleError)
    },
  },
  my: {
    create(data: MyAgentRequest) {
      return service
        .post('/api/my/agents', data)
        .then(res => res.data)
        .catch(handleError)
    },
    // 获取个人智能体列表
    list(params: { offset: number; limit: number }) {
      return service.get('/api/my/agents', { params, requiresAuth: true }).catch(handleError)
    },
    // 获取个人智能体详情
    detail(agent_id: number | string) {
      return service.get(`/api/my/agents/${agent_id}`).catch(handleError)
    },
    // 更新个人智能体
    update(agent_id: string, data: MyAgentRequest) {
      return service
        .put(`/api/my/agents/${agent_id}`, data)
        .then(res => res.data)
        .catch(handleError)
    },
    delete(agent_id: string) {
      return service
        .delete(`/api/my/agents/${agent_id}`)
        .then(res => res.data)
        .catch(handleError)
    },
    // 重置个人智能体密钥
    resetSecret(agent_id: string) {
      return service
        .post(`/api/my/agents/${agent_id}/reset-secret`)
        .then(res => res.data)
        .catch(handleError)
    }
  }
}

export default agentsApi

