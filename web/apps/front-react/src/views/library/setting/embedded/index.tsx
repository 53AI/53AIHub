import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Form, Spin, message } from 'antd'
import { chunkSettingApi, type ModelSetting } from '@/api/modules/chunk-setting'
import { useLibraryStore } from '@/stores/modules/library'
import { ModelSelect } from '@/components/Model/select'
import { Header } from '@/components/Header'
import { REASONING_MODE } from '@/constants/agent'
import './embedded.css'

const MODEL_USE_TYPE = {
  REASONING: '1',
  EMBEDDING: '2',
  RERANKER: '3'
}

const RERANKING_MODE = {
  WEIGHTED_SCORE: 'weighted_score',
  RERANKING_MODEL: 'reranking_model'
}

const defaultSetting: ModelSetting = {
  created_time: 1672502400,
  eid: 1,
  file_id: 1,
  id: 1,
  library_id: 1,
  model_config: {
    logic_reasoning: {
      channel_id: 0,
      model_name: 'string'
    },
    search_config: {
      fulltext: false,
      hybrid: false,
      rerank_model: RERANKING_MODE.RERANKING_MODEL,
      score_threshold: 0,
      top_k: 0,
      vector: true,
      rerank_channel_id: 0,
      rerank_model_name: '',
      reranking_enable: false,
      score_threshold_enabled: false,
      weights: {
        keyword_setting: {
          keyword_weight: 0
        },
        vector_setting: {
          vector_weight: 0
        }
      }
    },
    vector_embedding: {
      channel_id: 0,
      model_name: 'string'
    },
    fast_reasoning: {
      channel_id: 0,
      model_name: 'string'
    },
    version: 'string'
  },
  updated_time: 1672502400
}

export function LibraryEmbeddedSettingsView() {
  const { id } = useParams<{ id: string }>()
  const libraryStore = useLibraryStore()
  const [loading, setLoading] = useState(false)
  const [setting, setSetting] = useState<ModelSetting>(defaultSetting)

  const logicValue = setting.model_config.logic_reasoning.channel_id && setting.model_config.logic_reasoning.model_name
    ? `${setting.model_config.logic_reasoning.channel_id}_53aikm_${setting.model_config.logic_reasoning.model_name}`
    : ''

  const vectorValue = setting.model_config.vector_embedding.channel_id && setting.model_config.vector_embedding.model_name
    ? `${setting.model_config.vector_embedding.channel_id}_53aikm_${setting.model_config.vector_embedding.model_name}`
    : ''

  const fastReasoningValue = setting.model_config.fast_reasoning.channel_id && setting.model_config.fast_reasoning.model_name
    ? `${setting.model_config.fast_reasoning.channel_id}_53aikm_${setting.model_config.fast_reasoning.model_name}`
    : ''

  const updateLogicValue = (value: string) => {
    const [channel_id, model_name] = value.split('_53aikm_')
    setSetting(prev => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        logic_reasoning: {
          channel_id: Number(channel_id),
          model_name: model_name || ''
        }
      }
    }))
  }

  const updateVectorValue = (value: string) => {
    const [channel_id, model_name] = value.split('_53aikm_')
    setSetting(prev => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        vector_embedding: {
          channel_id: Number(channel_id),
          model_name: model_name || ''
        }
      }
    }))
  }

  const updateFastReasoningValue = (value: string) => {
    const [channel_id, model_name] = value.split('_53aikm_')
    setSetting(prev => ({
      ...prev,
      model_config: {
        ...prev.model_config,
        fast_reasoning: {
          channel_id: Number(channel_id),
          model_name: model_name || ''
        }
      }
    }))
  }

  const loadConfig = async () => {
    if (!libraryStore.library_id) return
    setLoading(true)
    try {
      const data = await chunkSettingApi.model.library.get(libraryStore.library_id)
      if (!data.model_config.search_config.rerank_model) {
        data.model_config.search_config.rerank_model = RERANKING_MODE.RERANKING_MODEL
      }
      setSetting(data)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!libraryStore.library_id) return

    if (!logicValue) {
      message.error('请选择逻辑推理模型')
      return
    }
    if (!vectorValue) {
      message.error('请选择向量嵌入模型')
      return
    }
    if (!fastReasoningValue) {
      message.error('请选择意图识别模型')
      return
    }

    setLoading(true)
    try {
      await chunkSettingApi.model.library.update(libraryStore.library_id, {
        model_config: setting.model_config
      })
      message.success('保存成功')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [libraryStore.library_id])

  return (
    <div className="h-screen flex flex-col overflow-hidden px-[60px] bg-[#F8F9FA]">
      <Header className="pt-8 pb-5" title="模型设置" />
      <Spin spinning={loading}>
        <div className="bg-[#ffffff] flex-1 gap-6 px-10 py-8 overflow-y-auto mb-5">
          <div className="max-w-[600px]">
            <Form layout="vertical">
              <Form.Item label="逻辑推理">
                <ModelSelect
                  value={logicValue}
                  type={MODEL_USE_TYPE.REASONING}
                  onChange={updateLogicValue}
                />
              </Form.Item>
              <Form.Item label="意图识别模型">
                <ModelSelect
                  value={fastReasoningValue}
                  type={MODEL_USE_TYPE.REASONING}
                  mode={REASONING_MODE.FAST}
                  onChange={updateFastReasoningValue}
                />
              </Form.Item>
              <Form.Item label="向量嵌入">
                <ModelSelect
                  value={vectorValue}
                  type={MODEL_USE_TYPE.EMBEDDING}
                  onChange={updateVectorValue}
                />
              </Form.Item>
            </Form>

            <Button type="primary" className="mt-6" onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </Spin>
    </div>
  )
}

export default LibraryEmbeddedSettingsView
