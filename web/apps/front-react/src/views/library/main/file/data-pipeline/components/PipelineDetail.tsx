import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Drawer, Button, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { Pipeline, PipelineStep } from '../types'
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES, STEP_KEY_TO_NAME, STEP_KEY_TO_DESCRIPTION } from '../constants'
import ChunkConfig from './configs/ChunkConfig'
import CleanConfig from './configs/CleanConfig'
import SummaryConfig from './configs/SummaryConfig'
import ParseConfig from './configs/ParseConfig'
import VectorConfig from './configs/VectorConfig'
import GraphConfig from './configs/GraphConfig'
import { t } from '@/locales'
import './PipelineDetail.css'

interface PipelineDetailProps {
  open: boolean
  pipeline: Pipeline
  onClose: () => void
  onSave: (pipeline: Pipeline) => void
  onEditBasic: (pipeline: Pipeline) => void
}

// Node config components map
const NODE_CONFIG_COMPONENTS: Record<string, React.FC<{ config: any; onChange?: (config: any) => void }>> = {
  document_parsing: ParseConfig,
  content_cleaning: CleanConfig,
  summary_generation: SummaryConfig,
  document_chunking: ChunkConfig,
  vector_indexing: VectorConfig,
  graph_generation: GraphConfig,
}

export function PipelineDetail({
  open,
  pipeline,
  onClose,
  onSave,
  onEditBasic,
}: PipelineDetailProps) {
  const [activeNodeIdx, setActiveNodeIdx] = useState(0)
  const [localPipeline, setLocalPipeline] = useState<Pipeline>(pipeline)

  // Only update local pipeline when drawer opens (open changes from false to true)
  const prevOpenRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      // Drawer just opened - initialize from prop
      setLocalPipeline(JSON.parse(JSON.stringify(pipeline)))
      setActiveNodeIdx(0)
    }
    prevOpenRef.current = open
  }, [open, pipeline])

  const visibleNodes = useMemo(() => {
    return (localPipeline?.profile_json?.steps || []).filter((n: PipelineStep) =>
      LIST_DISPLAY_NODE_TYPES.includes(n.step_key)
    )
  }, [localPipeline])

  const activeNode = useMemo(() => {
    return visibleNodes[activeNodeIdx] || visibleNodes[0]
  }, [visibleNodes, activeNodeIdx])

  const getAvailableStatuses = useCallback((type: string) => {
    const common = ['auto', 'manual']
    if (['graph_generation', 'vector_indexing', 'summary_generation', 'content_cleaning'].includes(type)) {
      return [...common, 'skip']
    }
    return common
  }, [])

  const getNodeIcon = (type: string) => NODE_ICONS_MAP[type] || 'document'

  const getNodeConfigComponent = (type: string) => {
    return NODE_CONFIG_COMPONENTS[type] || null
  }

  const handleNodeStatusChange = (status: string) => {
    if (!activeNode) return
    const newSteps = localPipeline.profile_json.steps.map((step: PipelineStep) => {
      if (step.step_key === activeNode.step_key) {
        return { ...step, run_mode: status as any }
      }
      return step
    })
    setLocalPipeline(prev => ({
      ...prev,
      profile_json: { ...prev.profile_json, steps: newSteps },
    }))
  }

  const handleConfigUpdate = (newConfig: any) => {
    if (!activeNode) return
    const newSteps = localPipeline.profile_json.steps.map((step: PipelineStep) => {
      if (step.step_key === activeNode.step_key) {
        return { ...step, config: newConfig }
      }
      return step
    })
    setLocalPipeline(prev => ({
      ...prev,
      profile_json: { ...prev.profile_json, steps: newSteps },
    }))
  }

  const handleConfirm = () => {
    // 验证图谱模板
    const graphStep = (localPipeline?.profile_json?.steps || []).find((s: PipelineStep) => s.step_key === 'graph_generation')
    const runMode = graphStep?.run_mode
    const templateId = graphStep?.config?.graph_template_id
    const isSmartMatchEnabled = Boolean(graphStep?.config?.enable_smart_match)

    if (runMode !== 'skip' && !isSmartMatchEnabled && !templateId) {
      message.warning('图谱生成未跳过时，请选择图谱模板')
      return
    }
    onSave(localPipeline)
  }

  const handleEditBasic = () => {
    onEditBasic(localPipeline)
  }

  const renderNodeConfig = () => {
    if (!activeNode) return null

    const ConfigComponent = getNodeConfigComponent(activeNode.step_key)
    if (!ConfigComponent) {
      return <div className="text-gray-400">No configuration available</div>
    }

    return (
      <ConfigComponent
        config={activeNode.config}
        onChange={(newConfig: any) => handleConfigUpdate(newConfig)}
      />
    )
  }

  const renderStatusBadge = (runMode: string) => {
    const statusConfig: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
      auto: { label: '自动', color: '#07C160', bgColor: '#EBFFF4', borderColor: '#D2FAE5' },
      manual: { label: '手动', color: '#EE7702', bgColor: '#FFFAF5', borderColor: '#F2E7DC' },
      skip: { label: '跳过', color: '#4F5052', bgColor: '#F7F7F7', borderColor: '#F7F7F7' },
    }

    const config = statusConfig[runMode] || statusConfig.skip

    return (
      <div
        className="h-6 px-2 text-sm flex items-center gap-1 rounded border"
        style={{
          color: config.color,
          backgroundColor: config.bgColor,
          borderColor: config.borderColor,
        }}
      >
        <SvgIcon
          name={runMode === 'auto' ? 'light' : runMode === 'manual' ? 'five-five' : 'power'}
          size={12}
        />
        {config.label}
      </div>
    )
  }

  const renderStatusButton = (status: string, isActive: boolean) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      auto: { label: '自动', color: '#07C160' },
      manual: { label: '手动', color: '#EE7702' },
      skip: { label: '跳过', color: '#4F5052' },
    }

    const config = statusConfig[status]

    return (
      <button
        key={status}
        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${
          isActive ? 'bg-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
        }`}
        style={isActive ? { color: config.color } : {}}
        onClick={() => handleNodeStatusChange(status)}
      >
        <SvgIcon
          name={status === 'auto' ? 'light' : status === 'manual' ? 'five-five' : 'power'}
          size={14}
          className={isActive ? '' : '!text-gray-400'}
        />
        {config.label}
      </button>
    )
  }

  return (
    <Drawer
      open={open}
      title={null}
      onClose={onClose}
      size={1100}
      className="pipeline-detail-drawer"
      closable={false}
      styles={{ body: { padding: 0 } }}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="primary" onClick={handleConfirm}>
            {t('action.save')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full overflow-hidden bg-white">
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3 px-2">
            <div className="flex-none w-8 h-8 rounded flex items-center justify-center">
              {localPipeline.icon && (
                <img src={localPipeline.icon} className="size-8 object-contain" alt="logo" />
              )}
            </div>
            <h2 className="font-bold text-gray-800 text-lg">
              {localPipeline.name || t('pipeline.add_pipeline')}
            </h2>
            {localPipeline.id && (
              <Button type="link" onClick={handleEditBasic} className="p-0">
                <SvgIcon name="edit" size={18} />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-gray-400 hover:text-gray-600 p-1 transition-colors"
              onClick={onClose}
            >
              <SvgIcon name="close" size={24} />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Nodes Flow */}
          <div className="w-96 bg-[#F7F8FA] border-r border-gray-100 p-6 overflow-y-auto overflow-x-hidden">
            <div className="text-sm text-[#999999] mb-4">数据管线</div>
            {visibleNodes.map((node, i) => (
              <React.Fragment key={node.step_key}>
                <button
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all border group relative ${
                    activeNodeIdx === i
                      ? 'bg-[#F0F5FF] shadow-sm border-[#2563EB] ring-4 ring-blue-50/50'
                      : 'bg-[#FFFFFF] border-[#E6E8EB] text-gray-500 hover:bg-gray-100'
                  }`}
                  onClick={() => setActiveNodeIdx(i)}
                >
                  <div
                    className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                      activeNodeIdx === i
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#2563EB14] text-[#2563EB]'
                    }`}
                  >
                    <SvgIcon name={getNodeIcon(node.step_key)} size={16} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm text-[#1D1E1F]">{STEP_KEY_TO_NAME[node.step_key] || node.name}</div>
                    <div className="text-xs text-[#999999]">{STEP_KEY_TO_DESCRIPTION[node.step_key] || node.description}</div>
                  </div>
                  {renderStatusBadge(node.run_mode || 'auto')}
                  {activeNodeIdx === i && (
                    <div className="flex items-center justify-center absolute -right-14 top-1/2 rotate-45 -translate-y-1/2 size-[35px] bg-[#fff]" />
                  )}
                </button>
                {i < visibleNodes.length - 1 && (
                  <div className="flex py-1 my-1 justify-center relative">
                    <SvgIcon name="arrow-down" className="text-[#DCDDE0]" size={12} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 border border-dashed border-[#DCDDE0]" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Right Content: Node Settings */}
          {activeNode && (
            <div className="flex-1 px-9 py-10 overflow-y-auto custom-scrollbar">
              {/* Top node title and status toggle */}
              <div className="flex items-center mb-6">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800">{STEP_KEY_TO_NAME[activeNode.step_key] || activeNode.name}节点配置</h3>
                  <p className="text-sm text-gray-400 mt-2">{STEP_KEY_TO_DESCRIPTION[activeNode.step_key] || activeNode.description}</p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  {getAvailableStatuses(activeNode.step_key).map(status =>
                    renderStatusButton(status, activeNode.run_mode === status)
                  )}
                </div>
              </div>

              {renderNodeConfig()}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

export default PipelineDetail
