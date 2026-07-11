import service from '../../config'
import { handleError } from '../../errorHandler'
import type {
  AgentUserMemoryResponse,
  AgentToolLessonsResponse,
  UserMemoryResponse,
  MemoryTypeItem,
  ReplaceAgentMemoryRequest,
  ReplaceAgentToolLessonsRequest,
  ReplaceUserMemoryRequest,
  ImportUserMemoryRequest,
} from './types'

const memoryApi = {
  /**
   * 智能体记忆接口
   */
  agent: {
    /**
     * 获取记忆类型列表
     * @param agent_id 智能体 ID
     */
    memoryList(agent_id: number | string): Promise<MemoryTypeItem[]> {
      return service
        .get(`/api/my/agents/${agent_id}/memory-list`)
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 获取 MEMORY.md 内容
     * @param agent_id 智能体 ID
     */
    getMemory(agent_id: number | string): Promise<AgentUserMemoryResponse> {
      return service
        .get(`/api/my/agents/${agent_id}/memory`)
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 获取 TOOLS.md 内容
     * @param agent_id 智能体 ID
     */
    getToolLessons(agent_id: number | string): Promise<AgentToolLessonsResponse> {
      return service
        .get(`/api/my/agents/${agent_id}/tool-lessons`)
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 全量替换 MEMORY.md
     * @param agent_id 智能体 ID
     * @param data 请求数据
     */
    replaceMemory(agent_id: number | string, data: ReplaceAgentMemoryRequest): Promise<AgentUserMemoryResponse> {
      return service
        .put(`/api/my/agents/${agent_id}/memory`, data)
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 全量替换 TOOLS.md
     * @param agent_id 智能体 ID
     * @param data 请求数据
     */
    replaceToolLessons(agent_id: number | string, data: ReplaceAgentToolLessonsRequest): Promise<AgentToolLessonsResponse> {
      return service
        .put(`/api/my/agents/${agent_id}/tool-lessons`, data)
        .then(res => res.data)
        .catch(handleError)
    },
  },

  /**
   * 用户全局记忆接口
   */
  user: {
    /**
     * 获取用户全局记忆
     */
    get(): Promise<UserMemoryResponse> {
      return service
        .get('/api/my/memory')
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 全量替换用户全局记忆
     * @param data 请求数据
     */
    replace(data: ReplaceUserMemoryRequest): Promise<UserMemoryResponse> {
      return service
        .put('/api/my/memory', data)
        .then(res => res.data)
        .catch(handleError)
    },

    /**
     * 导入自由文本为智能记忆
     * @param data 请求数据
     */
    import(data: ImportUserMemoryRequest): Promise<UserMemoryResponse> {
      return service
        .post('/api/my/memory/import', data)
        .then(res => res.data)
        .catch(handleError)
    },
  },
}

export default memoryApi
