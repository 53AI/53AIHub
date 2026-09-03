import { PermissionType } from '@/components/KMPermission/constant'
import service from '../config'
import { handleError } from '../errorHandler'

export type SpaceItem = {
  created_time: number
  description: string
  eid: number
  icon: string
  id: string
  name: string
  owner_id: number
  sort: number
  status: number
  library_count: number
  updated_time: number
  permission: PermissionType
  visibility: number
  enable_wiki_dynamic_knowledge?: boolean
  enable_wiki_knowledge_graph?: boolean
}

export type SpaceListResponse = {
  spaces: SpaceItem[]
  total: number
}

export type SpaceListRequest = {
  status: number
  offset: number
  limit: number
  name?: string
  view: 'user'
}

/**
 * 空间图谱配置
 * - library_ids 为空数组或 null 时表示「全部知识库」
 */
export type KnowledgeGraphConfig = {
  enable_knowledge_graph: boolean
  library_ids: string[] | null
}

export type SpaceCreateRequest = {
  name: string
  description: string
  icon: string
}



export const spacesApi = {
  list(data: SpaceListRequest): Promise<SpaceListResponse> {
    return service
      .get('/api/spaces', { params: data, requiresAuth: true })
      .then((res) => res.data)
      .catch(err => handleError(err, { functionName: window.$t('module.space') }))
  },
  create(data: SpaceCreateRequest) {
    return service.post('/api/spaces', data).catch(handleError)
  },
  update(space_id: SpaceItem['id'], data: SpaceCreateRequest) {
    return service.put(`/api/spaces/${space_id}`, data).catch(handleError)
  },
  delete(space_id: SpaceItem['id']) {
    return service.delete(`/api/spaces/${space_id}`).catch(handleError)
  },
  detail(space_id: SpaceItem['id']): Promise<SpaceItem> {
    return service
      .get(`/api/spaces/${space_id}`)
      .then((res) => res.data)
      .catch(handleError)
  },
  get(space_id: SpaceItem['id']): Promise<SpaceItem> {
    return service
      .get(`/api/spaces/${space_id}`)
      .then((res) => res.data)
      .catch(handleError)
  },
  /**
   * 获取空间图谱配置
   * GET /api/spaces/{space_id}/knowledge-graph
   */
  getKnowledgeGraph(space_id: SpaceItem['id']): Promise<KnowledgeGraphConfig> {
    return service
      .get(`/api/spaces/${space_id}/knowledge-graph`)
      .then((res: any) => {
        const data = res?.data ?? res ?? {}
        return {
          enable_knowledge_graph: Boolean(data.enable_knowledge_graph),
          library_ids: Array.isArray(data.library_ids) ? data.library_ids : [],
        } as KnowledgeGraphConfig
      })
      .catch(handleError)
  },
}

export default spacesApi
