import service from '../../config'
import {
  AgentShortcutItem,
  AgentShortcutCreateRequest,
  AgentShortcutListResponse,
  AgentShortcutCreateResponse,
} from './types'

const agentShortcutsApi = {
  /**
   * 获取智能体快捷方式列表
   */
  list(): Promise<AgentShortcutItem[]> {
    return service
      .get('/api/my/agent-shortcuts', { requiresAuth: true })
      .then((res) => res.data)
  },

  /**
   * 获取已添加的智能体快捷方式 ID 列表
   */
  getIds(): Promise<string[]> {
    return service
      .get('/api/my/agent-shortcuts/ids', { requiresAuth: true })
      .then((res) => res.data)
  },

  /**
   * 添加智能体快捷方式
   */
  create(data: AgentShortcutCreateRequest): Promise<AgentShortcutItem> {
    return service
      .post('/api/my/agent-shortcuts', data, { requiresAuth: true })
      .then((res) => res.data)
  },

  /**
   * 删除智能体快捷方式
   */
  delete(agent_id: string): Promise<void> {
    return service
      .delete(`/api/my/agent-shortcuts/${agent_id}`, { requiresAuth: true })
      .then(() => {})
  },

  /**
   * 置顶/取消置顶智能体快捷方式
   */
  pin(agent_id: string, pinned: boolean): Promise<AgentShortcutItem> {
    return service
      .patch(`/api/my/agent-shortcuts/${agent_id}/pin`, { is_pinned: pinned }, { requiresAuth: true })
      .then((res) => res.data)
  },
}

export default agentShortcutsApi