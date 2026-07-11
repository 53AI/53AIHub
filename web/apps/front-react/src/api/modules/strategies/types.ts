export interface Strategy {
  id: number
  eid: number
  name: string
  icon: string
  pipeline_id: number
  priority: number
  logic: number
  enabled: boolean
  conditions_json: string
  pipeline_name: string
  created_time: number
  updated_time: number
}

export interface StrategiesResponse {
  code: number
  message: string
  data: Strategy[]
}
