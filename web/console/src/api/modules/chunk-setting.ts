import service from '../config'
import { handleError } from '../errorHandler'

export interface ChunkSetting {
  chunking_config: {
    common_questions: {
      generation_method: string
    }
    content_summary: {
      generation_method: string
    }
    index_chunking: {
      include_title: true
      max_length: number
      overlap_size: number
      split_rule: string
    }
    knowledge_chunking: {
      include_title: true
      max_length: number
      overlap_size: number
      split_rule: string
    }
    version: string
  }
  created_time: number
  eid: number
  file_id: number
  id: number
  library_id: number
  updated_time: number
}

export interface ModelSetting {
  created_time: number
  eid: number
  file_id: number
  id: number
  library_id: number
  model_config: {
    version: string
    logic_reasoning: {
      channel_id: number | null
      model_name: string | null
    }
    vector_embedding: {
      channel_id: number | null
      model_name: string | null
    }
    search_config: {
      vector: boolean
      fulltext: boolean
      hybrid: boolean
      rerank_model: string
      rerank_channel_id: number
      rerank_model_name: string
      reranking_enable: boolean
      top_k: number
      score_threshold: number
      score_threshold_enabled: boolean
      weights: {
        keyword_setting: {
          keyword_weight: number
        }
        vector_setting: {
          vector_weight: number
        }
      }
    }
  }
  updated_time: number
}

export const chunkSettingApi = {
  list() {
    return service.get('/api/chunk-settings/list').catch(handleError)
  },
  channels: {
    list() {
      return service.get('/api/chunk-settings/channels').catch(handleError)
    },
  },
  chunkingConfig: {
    get(): Promise<ChunkSetting> {
      return service
        .get('/api/chunk-settings/chunking-config/site')
        .then(res => res.data)
        .catch(handleError)
    },
    update(data: { chunking_config: ChunkSetting['chunking_config'] }) {
      return service.put('/api/chunk-settings/chunking-config/site', data).catch(handleError)
    },
  },
  modelConfig: {
    get(): Promise<ModelSetting> {
      return service
        .get('/api/chunk-settings/model-config/site')
        .then(res => res.data)
        .catch(handleError)
    },
    update(data: { model_config: ModelSetting['model_config'] }) {
      return service.put('/api/chunk-settings/model-config/site', data).catch(handleError)
    },
  },

  // default: {
  //   get(): Promise<ChunkSetting> {
  //     return service
  //       .get('/api/chunk-settings/default')
  //       .then(res => res.data)
  //       .catch(handleError)
  //   },
  //   update(data: Partial<ChunkSetting>) {
  //     return service.put('/api/chunk-settings/default', data).catch(handleError)
  //   },
  // },
}

export default chunkSettingApi
