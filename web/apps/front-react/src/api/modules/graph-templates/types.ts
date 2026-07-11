export interface GraphTemplateEntity {
  name: string
  properties: string[]
  order_num?: number
}

export interface GraphTemplateRelation {
  source: string
  predicate: string
  target: string
}

export interface GraphTemplateListItem {
  id: string
  name: string
  description: string
  entity_count: number
  relation_count: number
  entity_preview: string
  relation_preview: string
  created_time: number
  updated_time: number
}

export interface GraphTemplateDetail {
  id: string
  name: string
  description: string
  entities: GraphTemplateEntity[]
  relations: GraphTemplateRelation[]
  created_time: number
  updated_time: number
}

export interface GraphTemplateListResponse {
  items: GraphTemplateListItem[]
  total: number
  offset: number
  limit: number
}

export interface CreateGraphTemplateRequest {
  name: string
  description?: string
  entities: GraphTemplateEntity[]
  relations?: GraphTemplateRelation[]
}

export type UpdateGraphTemplateRequest = Partial<CreateGraphTemplateRequest>

export interface SuggestRelationsRequest {
  entities: Omit<GraphTemplateEntity, 'order_num'>[]
  context?: string
}

export interface SuggestRelationsResponse {
  relations: GraphTemplateRelation[]
}
