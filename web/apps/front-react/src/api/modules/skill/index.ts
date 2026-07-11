import service from '../../config'
import { handleError } from '../../errorHandler'
import type {
  SkillExploreItem,
  SkillExploreQuery,
  SkillDetail,
  SkillMyItem,
  SkillEnvVarItem,
  PagedResponse,
  ApiResponse,
  UpdateMySkillStatusRequest,
  AgentSkillBindingItem,
} from './types'
import type { Skill } from './types'

export type { Skill }

export const skillApi = {
  /**
   * 获取探索列表
   * GET /api/skill-library/explore
   * 注：已不再返回 binding_id、added、binding_status
   */
  explore(params?: SkillExploreQuery): Promise<{ items: SkillExploreItem[]; count: number }> {
    return service
      .get('/api/skill-library/explore', { params })
      .then((res: { data: PagedResponse<SkillExploreItem> }) => ({
        items: res.data?.items || [],
        count: res.data?.count || 0,
      }))
      .catch(handleError)
  },

  /**
   * 获取技能详情
   * GET /api/skill-library/:id
   * 注：已不再返回 binding_id、added、binding_status
   */
  getDetail(id: string): Promise<SkillDetail> {
    return service
      .get(`/api/skill-library/${id}`)
      .then((res: { data: SkillDetail }) => res.data)
      .catch(handleError)
  },

  /**
   * 添加技能到"我的"
   * POST /api/skill-library/:id/add
   */
  addToMy(id: string): Promise<ApiResponse<null>> {
    return service.post(`/api/skill-library/${id}/add`)
  },

  /**
   * 获取我的技能列表
   * GET /api/skill-library/my
   */
  getMyList(params?: { offset?: number; limit?: number }) {
    return service
      .get('/api/skill-library/my', { params, requiresAuth: true })
      .then((res: { data: PagedResponse<SkillMyItem> }) => ({
        items: res.data?.items || [],
        count: res.data?.count || 0,
      }))
      .catch(handleError)
  },

  /**
   * 更新我的技能状态（启停）
   * PATCH /api/skill-library/my/{binding_id}/status
   */
  updateMySkillStatus(bindingId: string, data: UpdateMySkillStatusRequest) {
    return service.patch(`/api/skill-library/my/${bindingId}/status`, data).catch(handleError)
  },

  /**
   * 删除我的技能
   * DELETE /api/skill-library/my/{binding_id}
   */
  deleteMySkill(bindingId: string) {
    return service.delete(`/api/skill-library/my/${bindingId}`).catch(handleError)
  },

  /**
   * 下载技能安装包
   * GET /api/skill-library/{id}/download
   */
  downloadSkillPackage(id: string): Promise<Blob> {
    return service.get(`/api/skill-library/${id}/download`, {
      responseType: 'blob',
    }).then((res: Blob) => res).catch(handleError)
  },

  /**
   * 获取技能 SKILL.md
   * GET /api/skill-library/{id}/skill-md
   */
  getSkillMd(id: string) {
    return service.get(`/api/skill-library/${id}/skill-md`, {
      responseType: 'text',
    }).catch(handleError)
  },

  /**
   * 获取我的技能环境变量列表
   * GET /api/skill-library/:id/env-vars
   */
  getMyEnvVars(id: string): Promise<SkillEnvVarItem[]> {
    return service
      .get(`/api/skill-library/${id}/env-vars`, { requiresAuth: true })
      .then((res: { data: { items?: Array<{ id: string | number; key: string; value: string; sensitive: boolean }> } }) =>
        (res.data?.items || []).map(normalizeSkillEnvVarItem),
      )
      .catch(handleError)
  },

  /**
   * 创建我的技能环境变量
   * POST /api/skill-library/:id/env-vars
   */
  createMyEnvVar(
    id: string,
    data: { key: string; value: string; sensitive: boolean },
  ): Promise<SkillEnvVarItem> {
    return service
      .post(`/api/skill-library/${id}/env-vars`, data, { requiresAuth: true })
      .then((res: { data: { id: string | number; key: string; value: string; sensitive: boolean } }) =>
        normalizeSkillEnvVarItem(res.data),
      )
      .catch(handleError)
  },

  /**
   * 更新我的技能环境变量
   * PUT /api/skill-library/:id/env-vars/:env_var_id
   */
  updateMyEnvVar(
    id: string,
    envVarId: string,
    data: { key?: string; value?: string; sensitive?: boolean },
  ): Promise<SkillEnvVarItem> {
    return service
      .put(`/api/skill-library/${id}/env-vars/${envVarId}`, data, { requiresAuth: true })
      .then((res: { data: { id: string | number; key: string; value: string; sensitive: boolean } }) =>
        normalizeSkillEnvVarItem(res.data),
      )
      .catch(handleError)
  },

  /**
   * 删除我的技能环境变量
   * DELETE /api/skill-library/:id/env-vars/:env_var_id
   */
  deleteMyEnvVar(id: string, envVarId: string): Promise<void> {
    return service
      .delete(`/api/skill-library/${id}/env-vars/${envVarId}`, { requiresAuth: true })
      .then(() => undefined)
      .catch(handleError)
  },

  /**
   * 批量更新我的技能环境变量
   * PUT /api/skill-library/:id/env-vars/batch
   */
  batchUpdateMyEnvVars(
    id: string,
    data: { items: Array<{ key: string; value: string; sensitive: boolean }> },
  ): Promise<SkillEnvVarItem[]> {
    return service
      .put(`/api/skill-library/${id}/env-vars/batch`, data, { requiresAuth: true })
      .then((res: { data: { items?: Array<{ id: string | number; key: string; value: string; sensitive: boolean }> } }) =>
        (res.data?.items || []).map(normalizeSkillEnvVarItem),
      )
      .catch(handleError)
  },

  // ========== Agent 技能绑定（用户端） ==========

  /**
   * 获取 Agent 技能列表
   * GET /api/agent/:agent_id/skills
   */
  getAgentSkills(agentId: number | string): Promise<AgentSkillBindingItem[]> {
    return service
      .get(`/api/agent/${agentId}/skills`)
      .then((res: { data: { items: AgentSkillBindingItem[] } }) => res.data?.items || [])
      .catch(handleError)
  },

  /**
   * 给 Agent 添加个人技能
   * POST /api/agent/:agent_id/skills
   */
  addAgentSkill(agentId: number | string, skillLibraryId: number | string): Promise<void> {
    return service
      .post(`/api/agent/${agentId}/skills`, { skill_library_id: skillLibraryId })
      .then(() => undefined)
      .catch(handleError)
  },

  /**
   * 删除 Agent 个人技能绑定（仅 bind_type=user 可删）
   * DELETE /api/agent/:agent_id/skills/:binding_id
   */
  deleteAgentSkill(agentId: number | string, bindingId: number | string): Promise<void> {
    return service
      .delete(`/api/agent/${agentId}/skills/${bindingId}`)
      .then(() => undefined)
      .catch(handleError)
  },
}

function normalizeSkillEnvVarItem(item: {
  id?: string | number
  key: string
  value: string
  sensitive: boolean
}): SkillEnvVarItem {
  return {
    id: String(item?.id ?? ''),
    key: item?.key || '',
    value: item?.value || '',
    sensitive: Boolean(item?.sensitive),
  }
}

export default skillApi
