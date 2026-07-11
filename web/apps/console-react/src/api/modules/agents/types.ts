// Agent API Key 相关类型定义（从 api-key.ts 移动）

/**
 * Agent API Key 状态类型
 */
export type AgentAPIKeyStatus = 'active' | 'rotated' | 'revoked'

/**
 * Agent API Key 来源类型
 */
export type AgentAPIKeySource = 'api'

/**
 * Agent API Key 项目类型
 */
export interface AgentAPIKeyItem {
  id: string
  agent_id: string
  source: AgentAPIKeySource
  secret_key: string
  status: AgentAPIKeyStatus
  expires_at: number
  created_at: number
}

/**
 * 创建 Agent API Key 响应类型
 */
export interface CreateAgentAPIKeyResponse {
  secret_key: string
  agent_id: string
  source: AgentAPIKeySource
  expires_at: number
  status: AgentAPIKeyStatus
}

/**
 * 获取 Agent API Key 列表响应类型
 */
export interface ListAgentAPIKeyResponse {
  count: number
  list: AgentAPIKeyItem[]
}

/**
 * 创建 Agent API Key 请求类型
 */
export interface CreateAgentAPIKeyRequest {
  agent_id: string
  expired_days?: number
}

/**
 * 轮换 Agent API Key 响应类型
 */
export interface RotateAgentAPIKeyResponse {
  secret_key: string
  agent_id: string
  source: AgentAPIKeySource
  expires_at: number
  status: AgentAPIKeyStatus
}

/**
 * 吊销 Agent API Key 响应类型
 */
export interface RevokeAgentAPIKeyResponse {
  revoked: boolean
}

/**
 * Agent OpenAPI 文档端点类型
 */
export interface AgentOpenAPIDocsEndpoint {
  method: string
  path: string
  title: string
  description: string
  request?: Record<string, unknown>
  response?: Record<string, unknown>
}

/**
 * Agent OpenAPI 文档模板类型
 */
export interface AgentOpenAPIDocsTemplate {
  title: string
  base_url: string
  auth: Record<string, unknown>
  placeholders: Record<string, string>
  quick_start: string[]
  endpoints: AgentOpenAPIDocsEndpoint[]
  errors: Array<Record<string, string>>
}