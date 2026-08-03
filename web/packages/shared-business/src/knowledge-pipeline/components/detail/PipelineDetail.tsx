import { useState, useMemo, useRef, useEffect, type ComponentType } from 'react'
import { Drawer, Button, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { CloseOutlined, CaretDownOutlined } from '@ant-design/icons'
import { usePipelineTranslation } from '../../context'
import type { Pipeline, PipelineStep } from '../../types'
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES } from '../../constants'

// Import node config components
import { ParseConfig } from '../configs/ParseConfig'
import { ChunkConfig } from '../configs/ChunkConfig'
import { SummaryConfig } from '../configs/SummaryConfig'
import { VectorConfig } from '../configs/VectorConfig'
import { GraphConfig } from '../configs/GraphConfig'
import { CleanConfig } from '../configs/CleanConfig'

export interface PipelineDetailProps {
  open: boolean
  pipeline: Pipeline
  onChange: (pipeline: Pipeline) => void
  onClose: () => void
  onSave: (pipeline: Pipeline) => void
  onEditBasic?: (pipeline: Pipeline) => void
  /** Drawer width in pixels. Defaults to 1200 */
  width?: number
}

// Node config components map
const NODE_CONFIG_COMPONENTS: Record<string, ComponentType<{ config: any; onChange: (config: any) => void }>> = {
  document_parsing: ParseConfig,
  content_cleaning: CleanConfig,
  summary_generation: SummaryConfig,
  document_chunking: ChunkConfig,
  vector_indexing: VectorConfig,
  graph_generation: GraphConfig,
}

const getAvailableStatuses = (type: string) => {
  const common = ['auto', 'manual']
  if (['graph_generation', 'vector_indexing', 'summary_generation', 'content_cleaning'].includes(type)) {
    return [...common, 'skip']
  }
  return common
}

const getNodeIcon = (type: string) => NODE_ICONS_MAP[type] || 'document'

const getNodeConfigComponent = (type: string) => {
  return NODE_CONFIG_COMPONENTS[type] || null
}

export function PipelineDetail({
  open,
  pipeline,
  onChange,
  onClose,
  onSave,
  onEditBasic,
  width = 1200,
}: PipelineDetailProps) {
  const { t } = usePipelineTranslation()
  const [activeNodeIdx, setActiveNodeIdx] = useState(0)
  const [localPipeline, setLocalPipeline] = useState<Pipeline>(pipeline)

  const prevOpenRef = useRef(false)

  // 缓存深度复制结果，避免每次 render 都执行
  const pipelineSnapshot = useMemo(() => JSON.parse(JSON.stringify(pipeline)), [pipeline])

  // Sync local pipeline when drawer opens
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setLocalPipeline(pipelineSnapshot)
      setActiveNodeIdx(0)
    }
    prevOpenRef.current = open
  }, [open, pipelineSnapshot])

  const visibleNodes = useMemo(() => {
    return (localPipeline?.profile_json?.steps || []).filter((n: PipelineStep) =>
      LIST_DISPLAY_NODE_TYPES.includes(n.step_key)
    )
  }, [localPipeline])

  const activeNode = useMemo(() => {
    return visibleNodes[activeNodeIdx] || visibleNodes[0]
  }, [visibleNodes, activeNodeIdx])

  const handleNodeStatusChange = (status: string) => {
    if (!activeNode) return
    const newSteps = localPipeline.profile_json.steps.map((step: PipelineStep) => {
      if (step.step_key === activeNode.step_key) {
        return { ...step, run_mode: status as any }
      }
      return step
    })
    const updated = {
      ...localPipeline,
      profile_json: { ...localPipeline.profile_json, steps: newSteps },
    }
    setLocalPipeline(updated)
    onChange(updated)
  }

  const handleConfigUpdate = (newConfig: any) => {
    if (!activeNode) return
    const newSteps = localPipeline.profile_json.steps.map((step: PipelineStep) => {
      if (step.step_key === activeNode.step_key) {
        return { ...step, config: newConfig }
      }
      return step
    })
    const updated = {
      ...localPipeline,
      profile_json: { ...localPipeline.profile_json, steps: newSteps },
    }
    setLocalPipeline(updated)
    onChange(updated)
  }

  const handleConfirm = () => {
    // Validate graph template
    const graphStep = (localPipeline?.profile_json?.steps || []).find(
      (s: PipelineStep) => s.step_key === 'graph_generation'
    )
    const runMode = graphStep?.run_mode
    const templateId = graphStep?.config?.graph_template_id
    const isSmartMatchEnabled = Boolean(graphStep?.config?.enable_smart_match)

    if (graphStep && runMode !== 'skip' && !isSmartMatchEnabled && !templateId) {
      message.warning(t('data_pipeline.graph_template_required'))
      return
    }
    onSave(localPipeline)
  }

  const handleEditBasic = () => {
    onEditBasic?.(localPipeline)
  }

  const renderNodeConfig = () => {
    if (!activeNode) return null

    const ConfigComponent = getNodeConfigComponent(activeNode.step_key)
    if (!ConfigComponent) {
      return <div className="text-gray-400">{t('data_pipeline.no_config_available')}</div>
    }

    return (
      <ConfigComponent
        config={activeNode.config}
        onChange={handleConfigUpdate}
      />
    )
  }

  const statusConfig = (runMode: string) => {
    const configs: Record<string, { color: string; bgColor: string; borderColor: string }> = {
      auto: { color: '#07C160', bgColor: '#EBFFF4', borderColor: '#D2FAE5' },
      manual: { color: '#EE7702', bgColor: '#FFFAF5', borderColor: '#F2E7DC' },
      skip: { color: '#4F5052', bgColor: '#F7F7F7', borderColor: '#F7F7F7' },
    }
    return configs[runMode] || configs.skip
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      styles={{
        wrapper: { width },
        body: { padding: 0 },
      }}
    >
      <div className="flex flex-col h-full overflow-hidden bg-white">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3 px-2">
            <div className="flex-none w-8 h-8 rounded flex items-center justify-center">
              {localPipeline.icon && (
                <img
                  src={localPipeline.icon}
                  className="size-8 object-contain"
                  alt="logo"
                />
              )}
            </div>
            <h2 className="font-bold text-gray-800 text-lg">
              {localPipeline.name || t('data_pipeline.add_pipeline')}
            </h2>
            {localPipeline.id && onEditBasic && (
              <Button type="link" onClick={handleEditBasic}>
                <SvgIcon name="edit" size={18} />
              </Button>
            )}
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 p-1 transition-colors"
            onClick={onClose}
          >
            <CloseOutlined style={{ fontSize: 24 }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Nodes Flow */}
          <div className="w-96 bg-[#F7F8FA] border-r border-gray-100 p-6 overflow-y-auto overflow-x-hidden">
            <div className="text-sm text-gray-400 mb-4">
              {t('data_pipeline.section_title')}
            </div>
            {visibleNodes.map((node, i) => (
              <div key={node.step_key}>
                <button
                  className="w-full flex items-center gap-3 p-3 rounded-lg transition-all border group relative"
                  style={{
                    backgroundColor: activeNodeIdx === i ? '#F0F5FF' : '#FFFFFF',
                    borderColor: activeNodeIdx === i ? '#2563EB' : '#E6E8EB',
                    boxShadow: activeNodeIdx === i
                      ? '0 0 0 4px rgba(37, 99, 235, 0.1)'
                      : undefined,
                  }}
                  onClick={() => setActiveNodeIdx(i)}
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: activeNodeIdx === i ? '#2563EB' : '#2563EB14',
                      color: activeNodeIdx === i ? 'white' : '#2563EB',
                    }}
                  >
                    <SvgIcon name={getNodeIcon(node.step_key)} size={16} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm text-gray-800">{t(node.name)}</div>
                    <div className="text-xs text-gray-400">{t(node.description)}</div>
                  </div>
                  <div
                    className="h-6 px-2 text-sm flex items-center gap-1 rounded border"
                    style={statusConfig(node.run_mode || 'auto')}
                  >
                    <SvgIcon
                      name={node.run_mode === 'auto' ? 'light' : node.run_mode === 'manual' ? 'five-five' : 'power'}
                      size={12}
                    />
                    {t(`data_pipeline.run_mode_${node.run_mode || 'auto'}`)}
                  </div>
                  {activeNodeIdx === i && (
                    <div className="flex items-center justify-center absolute -right-14 top-1/2 rotate-45 -translate-y-1/2 size-[35px] bg-white" />
                  )}
                </button>
                {i < visibleNodes.length - 1 && (
                  <div className="flex py-1 my-1 justify-center relative">
                    <CaretDownOutlined style={{ color: '#DCDDE0' }} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 border border-dashed border-[#DCDDE0]" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right Content: Node Settings */}
          {activeNode && (
            <div className="flex-1 px-9 py-10 overflow-y-auto custom-scrollbar">
              {/* Node title and status toggle */}
              <div className="flex items-center mb-6">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800">
                    {t(activeNode.name)}
                    {t('data_pipeline.node_config')}
                  </h3>
                  <p className="text-sm text-gray-400 mt-2">
                    {t(activeNode.description)}
                  </p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  {getAvailableStatuses(activeNode.step_key).map((status) => (
                    <button
                      key={status}
                      className="px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2"
                      style={{
                        backgroundColor: activeNode.run_mode === status ? 'white' : undefined,
                        color: activeNode.run_mode === status
                          ? statusConfig(status).color
                          : '#9ca3af',
                        boxShadow: activeNode.run_mode === status
                          ? '0 1px 2px rgba(0,0,0,0.05)'
                          : undefined,
                      }}
                      onClick={() => handleNodeStatusChange(status)}
                    >
                      <SvgIcon
                        name={status === 'auto' ? 'light' : status === 'manual' ? 'five-five' : 'power'}
                        size={14}
                      />
                      {t(`data_pipeline.run_mode_${status}`)}
                    </button>
                  ))}
                </div>
              </div>

              {renderNodeConfig()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="primary" onClick={handleConfirm}>
            {t('action.save')}
          </Button>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #e5e7eb;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background-color: transparent;
        }
      `}</style>
    </Drawer>
  )
}

export default PipelineDetail
