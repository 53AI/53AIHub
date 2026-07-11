export interface GraphTemplateListItem {
  id: string
  name: string
  description?: string
  logo?: string
  entities: string
  entity_count: number
  relations: string
  relation_count: number
  entity_preview: string
  relation_preview: string
  created_time: number
  updated_time: number
}

export interface GraphTemplateListResponse {
  items: GraphTemplateListItem[]
  total: number
  offset: number
  limit: number
}

export interface GraphTemplateEntity {
  name: string
  properties: string[]
  order_num?: number
  logo?: string
}

export interface GraphTemplateRelation {
  source: string
  predicate: string
  target: string
}

export interface GraphTemplateDetail {
  id: string
  name: string
  description?: string
  logo?: string
  entities: GraphTemplateEntity[]
  relations: GraphTemplateRelation[]
  created_time: number
  updated_time: number
}

export interface CreateGraphTemplateRequest {
  name: string
  description?: string
  logo?: string
  entities: GraphTemplateEntity[]
  relations?: GraphTemplateRelation[]
}

export interface UpdateGraphTemplateRequest extends CreateGraphTemplateRequest {}

export interface SuggestRelationsRequestEntity {
  name: string
  properties: string[]
  order_num?: number
}

export interface SuggestRelationsRequest {
  entities: SuggestRelationsRequestEntity[]
  context?: string
}

export interface SuggestRelationsResponse {
  relations: GraphTemplateRelation[]
}

export interface SuggestTemplateParamsResponse {
  name: string
  description: string
  entities: {
    name: string
    order_num: number
    properties: string[]
  }[]
  relations: {
    predicate: string
    source: string
    target: string
  }[]
}