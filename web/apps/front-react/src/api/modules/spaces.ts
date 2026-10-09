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

/** 图谱生成进度项（GET /api/spaces/{space_id}/graph/progress/{file_id}） */
export type GraphProgressItem = {
  file_id: number
  file_name: string
  file_path: string
  run_id: string
  status: string
  progress: number
  success_count: number
  failure_count: number
  total_steps: number
  step_key: string
  step_name: string
  start_time: number
  end_time: number
  updated_time: number
}

/** 图谱生成任务步骤 */
export type GraphProgressStep = {
  id: number
  job_id: number
  eid: number
  step_order: number
  parameters: string
  results: string
  status: string
  start_time: number
  end_time: number
}

/** 图谱生成任务（type: graph_pipeline_generation） */
export type GraphProgressJob = {
  job_id: number
  eid: number
  type: string
  status: string
  current_step_order: number
  failure_reason?: string
  run_id: string
  related_id: number
  pipeline_id: number
  progress: number
  completion_time: number
  created_time: number
  updated_time: number
  steps: GraphProgressStep[]
}

/** 文件图谱生成进度响应 */
export type GraphProgressData = {
  progress_item?: GraphProgressItem
  jobs?: GraphProgressJob[]
  steps?: GraphProgressStep[]
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

  /**
   * 获取文件图谱生成进度
   * GET /api/spaces/{space_id}/graph/progress/{file_id}
   */
  getGraphProgress(
    space_id: SpaceItem['id'],
    file_id: string | number
  ): Promise<GraphProgressData> {
    return service
      .get(`/api/spaces/${space_id}/graph/progress/${file_id}`)
      .then((res: any) => {
        const data = res?.data ?? {}
        return {
          progress_item: data.progress_item,
          jobs: Array.isArray(data.jobs) ? data.jobs : [],
          steps: Array.isArray(data.steps) ? data.steps : [],
        } as GraphProgressData
      })
      .catch(handleError)
  },
}

export default spacesApi
