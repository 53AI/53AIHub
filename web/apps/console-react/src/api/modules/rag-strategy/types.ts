export type StrategyLogic = 1 | 2

export type MatcherType = 'extension' | 'filename' | 'foldername' | 'space_name'

export type MatcherOperator = 'in' | 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'eq'

export interface Matcher {
  type: MatcherType
  operator: MatcherOperator
  value: string | string[]
}

export interface StrategyConditionsJson {
  matchers: Matcher[]
}

/** Pipeline step 配置 */
export interface PipelineStep {
  step_key: string
  name: string
  description?: string
  run_mode: 'auto' | 'skip' | 'manual'
  config: Record<string, any>
}

/** Pipeline profile */
export interface PipelineProfile {
  steps: PipelineStep[]
}

/** 后端返回的 pipeline 对象 (detail=1 时) */
export interface StrategyPipeline {
  id: string
  name: string
  icon: string
  profile_json: string | PipelineProfile
  created_time?: number
  updated_time?: number
  success_count?: number
  failure_count?: number
  status?: number
}

export interface Strategy {
  id: string
  name: string
  icon: string
  priority: number
  pipeline_id: string
  pipeline_name?: string
  logic: StrategyLogic
  enabled: boolean
  is_default: boolean
  conditions_json: string | StrategyConditionsJson
  /** 后端返回的 pipeline 对象 (detail=1 时) */
  pipeline?: StrategyPipeline
  /** 前端解析后的 pipeline 配置对象 */
  pipeline_profile?: PipelineProfile
}

export interface CreateStrategyRequest {
  icon: string
  name: string
  priority: number
  pipeline_id: string
  logic: StrategyLogic
  enabled: boolean
  conditions_json: StrategyConditionsJson
}

export interface UpdateStrategyRequest {
  icon?: string
  name?: string
  priority?: number
  pipeline_id?: string
  logic?: StrategyLogic
  enabled?: boolean
  conditions_json?: StrategyConditionsJson
}

export interface ReorderStrategyRequest {
  strategy_ids: string[]
}
