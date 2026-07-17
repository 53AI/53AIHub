import service from '@/api/config'
import { handleError } from '@/api/errorHandler'
import {
  AdminImportSkillRequest, AdminAIGenerateRequest, AdminUpdateSkillRequest,
  AdminSkillListQuery, SkillExploreQuery, SkillPublic, SkillDetail, SkillMyItem,
  PagedResponse, SkillFileItem, SkillFileContentResult, SkillFileUpdateRequest,
  SkillFileUpdateResult, SkillEnvVar, CreateSkillEnvVarRequest,
  UpdateSkillEnvVarRequest, BatchUpdateSkillEnvVarsRequest, ForceImportSkillRequest,
  AgentSkillBindingItem,
} from './types'

export const skillApi = {
  // 导入
  async import(data: AdminImportSkillRequest) {
    const { data: resultData = {} } = await service
      .post('/api/admin/skill-library/import', data)
    return resultData
  },
  // 强制导入高风险技能
  async forceImport(data: ForceImportSkillRequest) {
    const { data: resultData = {} } = await service
      .post('/api/admin/skill-library/import/force', data)
    return resultData
  },
  // 获取技能详情，含最新扫描结果和权限分组
  async detail({ skill_id }: { skill_id: string }) {
    const { data = {} } = await service.get(`/api/admin/skill-library/${skill_id}`).catch(handleError)
    return data
  },
  // AI生成技能文案
  async aiGenerate(skill_id: string, data: AdminAIGenerateRequest) {
    return service.post(`/api/admin/skill-library/${skill_id}/ai-generate`, data)
  },
  // 更新技能信息
  async update(skill_id: string, data: AdminUpdateSkillRequest) {
    return service.put(`/api/admin/skill-library/${skill_id}`, data).catch(handleError)
  },
  // 后台技能列表（含平台技能）
  async list({
    params = {},
  }: AdminSkillListQuery = {}) {
    const queryParams = JSON.parse(JSON.stringify(params))
    if (!queryParams.group_id) delete queryParams.group_id
    if (!queryParams.keyword) delete queryParams.keyword
    const { data: { count = 0, items = [] } = {} } = await service
      .get(`/api/admin/skill-library/list`, { params: queryParams })
      .catch(handleError)
    return { total: +count || 0, list: items }
  },
  // 获取skill-md文件
  getSkillMd(skill_id: string) {
    return service.get(`/api/skill-library/${skill_id}/skill-md`).catch(handleError)
  },
  // 删除技能
  async delete({ skill_id }: { skill_id: number }) {
    return service.delete(`/api/admin/skill-library/${skill_id}`).catch(handleError)
  },
  // 更新技能状态（启用/停用）
  async update_status({ skill_id, admin_status }: { skill_id: string | number; admin_status: 'enabled' | 'disabled' }) {
    return service.patch(`/api/admin/skill-library/${skill_id}/status`, { admin_status }).catch(handleError)
  },
  // 获取探索列表（有权限限制）
  explore(params?: SkillExploreQuery): Promise<{ items: SkillPublic[]; count: number }> {
    return service
      .get('/api/skill-library/explore', { params })
      .then((res: { data: PagedResponse<SkillPublic> }) => ({
        items: res.data?.items || [],
        count: res.data?.count || 0,
      }))
      .catch(handleError)
  },
  // 获取我的技能列表
  getMyList(params?: { offset?: number; limit?: number }): Promise<{ items: SkillMyItem[]; count: number }> {
    return service
      .get('/api/skill-library/my', { params })
      .then((res: { data: PagedResponse<SkillMyItem> }) => ({
        items: res.data?.items || [],
        count: res.data?.count || 0,
      }))
      .catch(handleError)
  },
  // 查询导入任务状态
  async getImportJob({ id }: { id: number }) {
    const { data = {} } = await service.get(`/api/admin/skill-library/import/jobs/${id}`).catch()
    return data
  },
  // 获取技能包文件树
  async getFileList(skill_id: string): Promise<SkillFileItem[]> {
    const { data = {} } = await service
      .get(`/api/admin/skill-library/${skill_id}/files`)
      .catch(handleError)
    return data.files || []
  },
  // 获取文件内容
  async getFileContent(skill_id: string, path: string): Promise<SkillFileContentResult> {
    const { data = {} } = await service
      .get(`/api/admin/skill-library/${skill_id}/files/${encodeURIComponent(path)}`)
      .catch(handleError)
    return data
  },
  // 批量更新文件（修改、创建、删除）
  async updateFiles(skill_id: string, data: SkillFileUpdateRequest): Promise<SkillFileUpdateResult> {
    const { data: resultData = {} } = await service
      .put(`/api/admin/skill-library/${skill_id}/files`, data)
      .catch(handleError)
    return resultData
  },
  // 重载技能管理器
  async reload(): Promise<void> {
    await service.post('/api/admin/skill-library/reload').catch(handleError)
  },
  // ========== 环境变量相关 ==========
  // 获取环境变量列表
  async getEnvVars(skill_id: string): Promise<SkillEnvVar[]> {
    const { data = {} } = await service
      .get(`/api/admin/skill-library/${skill_id}/env-vars`)
      .catch(handleError)
    return data.items || []
  },
  // 创建环境变量
  async createEnvVar(skill_id: string, data: CreateSkillEnvVarRequest): Promise<SkillEnvVar> {
    const { data: resultData = {} } = await service
      .post(`/api/admin/skill-library/${skill_id}/env-vars`, data)
      .catch(handleError)
    return resultData
  },
  // 更新环境变量
  async updateEnvVar(skill_id: string, env_var_id: string, data: UpdateSkillEnvVarRequest): Promise<SkillEnvVar> {
    const { data: resultData = {} } = await service
      .put(`/api/admin/skill-library/${skill_id}/env-vars/${env_var_id}`, data)
      .catch(handleError)
    return resultData
  },
  // 删除环境变量
  async deleteEnvVar(skill_id: string, env_var_id: string): Promise<void> {
    await service
      .delete(`/api/admin/skill-library/${skill_id}/env-vars/${env_var_id}`)
      .catch(handleError)
  },
  // 批量替换环境变量（全量覆盖）
  async batchUpdateEnvVars(skill_id: string, data: BatchUpdateSkillEnvVarsRequest): Promise<SkillEnvVar[]> {
    const { data: resultData = {} } = await service
      .put(`/api/admin/skill-library/${skill_id}/env-vars/batch`, data)
      .catch(handleError)
    return resultData.items || []
  },

  // ========== Agent 内置技能绑定（管理员端） ==========

  /**
   * 获取 Agent 内置技能列表
   * GET /api/admin/agent/:agent_id/skills/builtin
   */
  async getAgentBuiltinSkills(agentId: number | string): Promise<AgentSkillBindingItem[]> {
    const { data = {} } = await service
      .get(`/api/admin/agent/${agentId}/skills/builtin`)
      .catch(handleError)
    return data.items || []
  },

  /**
   * 给 Agent 添加内置技能
   * POST /api/admin/agent/:agent_id/skills/builtin
   */
  async addAgentBuiltinSkill(agentId: number | string, skillLibraryId: string): Promise<void> {
    await service
      .post(`/api/admin/agent/${agentId}/skills/builtin`, { skill_library_id: skillLibraryId })
      .catch(handleError)
  },

  /**
   * 删除 Agent 内置技能绑定
   * DELETE /api/admin/agent/:agent_id/skills/builtin/:binding_id
   */
  async deleteAgentBuiltinSkill(agentId: number | string, bindingId: string): Promise<void> {
    await service
      .delete(`/api/admin/agent/${agentId}/skills/builtin/${bindingId}`)
      .catch(handleError)
  },
}

export default skillApi