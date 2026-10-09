import request from '../../index'

/** 图谱生成策略步骤（pipeline.profile_json.steps 内） */
export interface GraphStrategyStep {
  step_key: string
  config: Record<string, any>
  run_mode?: string
}

export interface GraphStrategyProfile {
  steps: GraphStrategyStep[]
}

/** detail=1 时策略附带的完整 pipeline 对象 */
export interface GraphStrategyPipeline {
  id: string
  name: string
  icon: string
  profile_json: GraphStrategyProfile | string
}

export interface GraphStrategy {
  id: string
  name: string
  icon: string
  priority: number
  pipeline_id: string
  enabled: boolean
  is_default: boolean
  kind: 'graph'
  /** detail=1 时附带 */
  pipeline?: GraphStrategyPipeline
}

/** 解析 pipeline.profile_json 字符串字段 */
const parseStrategy = (item: GraphStrategy): GraphStrategy => {
  const profile = item.pipeline?.profile_json
  if (typeof profile === 'string') {
    try {
      item.pipeline!.profile_json = JSON.parse(profile) as GraphStrategyProfile
    } catch {
      /* 保持字符串,调用方自行兜底 */
    }
  }
  return item
}

export const graphStrategyApi = {
  /**
   * 获取图谱生成策略列表
   * GET /api/rag/v2/graph-strategies
   * @param opts.detail 传 1 时附带完整 pipeline 对象(含 profile_json)
   */
  getList(opts?: { detail?: 0 | 1 }): Promise<GraphStrategy[]> {
    const params = opts?.detail ? { detail: 1 } : undefined
    return request
      .get('/api/rag/v2/graph-strategies', { params })
      .then((res: any) => {
        const data = res?.data ?? res ?? []
        return (Array.isArray(data) ? data : []).map(parseStrategy)
      })
  },
}

export default graphStrategyApi
