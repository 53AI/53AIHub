import request from '../index'

export interface ChunkSetting {
  chunking_config: {
    common_questions: {
      generation_method: string
    }
    content_summary: {
      generation_method: string
    }
    index_chunking: {
      include_title: boolean
      include_filename: boolean
      max_length: number
      overlap_size: number
      split_rule: string
      chunk_mode: string
    }
    knowledge_chunking: {
      include_title: boolean
      include_filename: boolean
      max_length: number
      overlap_size: number
      split_rule: string
      chunk_mode: string
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

export interface ChunkSettingConfig {
  chunking_config: {
    common_questions: {
      generation_method: string
    }
    content_summary: {
      generation_method: string
    }
    index_chunking: {
      include_title: boolean
      include_filename: boolean
      max_length: number
      overlap_size: number
      split_rule: string
    }
    knowledge_chunking: {
      include_title: boolean
      include_filename: boolean
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
      channel_type?: number | null
      model_name: string | null
    }
    vector_embedding: {
      channel_id: number | null
      channel_type?: number | null
      model_name: string | null
    }
    fast_reasoning: {
      channel_id: number | null
      channel_type?: number | null
      model_name: string | null
    }
    search_config: {
      vector: boolean
      fulltext: boolean
      hybrid: boolean
      rerank_model: string
      rerank_channel_id: number
      rerank_channel_type?: number
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

export interface ExtensionMap {
  base_extension_chunk_type_map: {
    doc: string[]
    html: string[]
    md: string[]
    pdf: string[]
    ppt: string[]
    xls: string[]
  }
  document_extension_map: {
    doc: string[]
    html: string[]
    md: string[]
    pdf: string[]
    ppt: string[]
    xls: string[]
  }
}

export const chunkSettingApi = {
  list(): Promise<ChunkSetting[]> {
    return request.get('/api/chunk-settings').then((res) => res.data)
  },

  default: {
    get(): Promise<ChunkSetting> {
      return request.get('/api/chunk-settings/default').then((res) => res.data)
    }
  },

  config: {
    get() {
      return request.get('/api/chunk-settings/document-extension-map').then((res) => res.data)
    },

    document: {
      get(file_id: string): Promise<ChunkSettingConfig> {
        return request.get(`/api/chunk-settings/chunking-config/document/${file_id}`).then((res) => res.data)
      },

      update(file_id: string, data: { chunking_config: ChunkSettingConfig['chunking_config'] }): Promise<void> {
        return request.put(`/api/chunk-settings/chunking-config/document/${file_id}`, data)
      }
    },

    library: {
      get(library_id: string): Promise<ChunkSettingConfig> {
        return request.get(`/api/chunk-settings/chunking-config/library/${library_id}`).then((res) => res.data)
      },

      update(library_id: string, data: { chunking_config: ChunkSettingConfig['chunking_config'] }): Promise<void> {
        return request.put(`/api/chunk-settings/chunking-config/library/${library_id}`, data)
      }
    }
  },

  chunkingConfig: {
    get(): Promise<ChunkSetting> {
      return request.get('/api/chunk-settings/chunking-config/site').then((res) => res.data)
    },

    update(data: { chunking_config: ChunkSetting['chunking_config'] }) {
      return request.put('/api/chunk-settings/chunking-config/site', data)
    }
  },

  modelConfig: {
    get(): Promise<ModelSetting> {
      return request.get('/api/chunk-settings/model-config/site').then((res) => res.data)
    },

    update(data: { model_config: ModelSetting['model_config'] }) {
      return request.put('/api/chunk-settings/model-config/site', data)
    }
  },

  model: {
    library: {
      get(library_id: string) {
        return request.get(`/api/chunk-settings/model-config/library/${library_id}`).then((res) => res.data)
      },

      update(library_id: string, data: { model_config: ModelSetting }) {
        return request.put(`/api/chunk-settings/model-config/library/${library_id}`, data)
      }
    }
  },

  libraryChunkSetting: {
    get(library_id: string) {
      return request.get(`/api/chunk-settings/model-config/library/${library_id}`).then((res) => res.data)
    }
  },

  extensionMap: {
    get(): Promise<ExtensionMap> {
      return request.get('/api/chunk-settings/document-extension-map').then((res) => res.data)
    }
  }
}

export default chunkSettingApi
