import React, { useEffect, useState, useCallback } from 'react'
import { Button, Spin, Table, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import PipelineDetail from './components/PipelineDetail'
import PipelineBasicDialog from './components/PipelineBasicDialog'
import { usePipeline } from './usePipeline'
import { NODE_ICONS_MAP, LIST_DISPLAY_NODE_TYPES } from './constants'
import type { Pipeline, PipelineStep } from './types'
import { t } from '@/locales'
import './DataPipeline.css'

export function DataPipeline() {
  const {
    pipelines,
    isLoading,
    detailVisible,
    currentPipeline,
    fetchPipelines,
    handleEdit,
    handleAdd,
    handleSave,
    handleDelete,
    setDetailVisible,
    setCurrentPipeline,
  } = usePipeline()

  const [basicDialogVisible, setBasicDialogVisible] = useState(false)
  const [basicDialogPipeline, setBasicDialogPipeline] = useState<Pipeline | null>(null)

  // Handle add pipeline - first open basic info dialog
  const handleAddPipeline = () => {
    setBasicDialogPipeline(null)
    setBasicDialogVisible(true)
  }

  // Handle basic info confirm - then open detail drawer
  const handleBasicConfirm = async (basicData: { name: string; icon: string }) => {
    // Create new pipeline and set basic info
    const newPipeline = handleAdd()
    if (newPipeline) {
      newPipeline.name = basicData.name
      newPipeline.icon = basicData.icon
      // Ensure currentPipeline is set
      setCurrentPipeline(newPipeline)
      // Wait for next tick to ensure reactive update completes
      setTimeout(() => {
        setDetailVisible(true)
      }, 0)
    }
  }

  // Handle edit basic info
  const handleEditBasic = (pipeline: Pipeline) => {
    setBasicDialogPipeline(pipeline)
    setBasicDialogVisible(true)
  }

  // Handle basic info dialog confirm (edit mode)
  const handleBasicConfirmEdit = (basicData: { name: string; icon: string }) => {
    if (currentPipeline && basicDialogPipeline) {
      // Update current pipeline basic info
      currentPipeline.name = basicData.name
      currentPipeline.icon = basicData.icon
    }
  }

  // Handle basic info dialog confirm - unified handler
  const handleBasicDialogConfirm = async (basicData: { name: string; icon: string }) => {
    if (basicDialogPipeline) {
      // Edit mode
      handleBasicConfirmEdit(basicData)
    } else {
      // Create mode
      await handleBasicConfirm(basicData)
    }
  }

  // Initialize data
  useEffect(() => {
    fetchPipelines()
  }, [fetchPipelines])

  // Get node icon
  const getNodeIcon = (stepKey: string) => NODE_ICONS_MAP[stepKey] || 'document'

  // Filter list display nodes
  const getDisplayNodes = (nodes: PipelineStep[]) =>
    nodes.filter(n => LIST_DISPLAY_NODE_TYPES.includes(n.step_key))

  // Render node status icon
  const renderNodeStatusIcon = (runMode: string) => {
    if (runMode === 'skip') return null

    const isAuto = runMode === 'auto'
    return (
      <div
        className={`absolute -top-1.5 -right-1.5 size-5 rounded flex items-center justify-center border border-white ${
          isAuto
            ? 'text-[#07C160] bg-[#F0FFF7] border-[#E1F5EB]'
            : 'text-[#EE7702] bg-[#FFF7F0] border-[#F5EBE1]'
        }`}
      >
        <SvgIcon name={isAuto ? 'light' : 'five-five'} size={12} />
      </div>
    )
  }

  // Table columns
  const columns = [
    {
      title: t('name'),
      dataIndex: 'name',
      key: 'name',
      render: (_: any, record: Pipeline) => (
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 size-12 rounded-lg overflow-hidden">
            <img src={record.icon} className="size-12 object-contain" alt={record.name} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-[#1D1E1F]">{record.name}</span>
            </div>
            <div className="text-sm text-[#999999] mt-0.5">
              {t('pipeline.created_time')}: {record.created_at}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t('pipeline.enabled_nodes'),
      dataIndex: 'nodes',
      key: 'nodes',
      render: (_: any, record: Pipeline) => (
        <div className="flex items-center gap-1.5">
          {getDisplayNodes(record.profile_json.steps).map(node => (
            <div
              key={node.step_key}
              className={`relative size-8 rounded flex items-center justify-center transition-all ${
                node.run_mode !== 'skip'
                  ? 'bg-[#EEF3FE] text-[#2563EB]'
                  : 'bg-[#F7F8FA] text-[#999999]'
              }`}
              title={node.name}
            >
              <SvgIcon name={getNodeIcon(node.step_key)} size={14} />
              {node.run_mode !== 'skip' && renderNodeStatusIcon(node.run_mode || 'auto')}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: t('pipeline.processed_count'),
      dataIndex: ['stats', 'total'],
      key: 'total',
      align: 'center' as const,
      render: (total: number) => (
        <span className="text-gray-600 font-medium">{total}</span>
      ),
    },
    {
      title: t('pipeline.success_rate'),
      dataIndex: ['stats', 'success_rate'],
      key: 'success_rate',
      align: 'center' as const,
      render: (rate: number) => (
        <span className="text-emerald-500 bg-emerald-50 px-2 py-1 rounded">
          {rate}%
        </span>
      ),
    },
    {
      title: t('action'),
      key: 'actions',
      align: 'right' as const,
      render: (_: any, record: Pipeline) => (
        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity gap-1">
          <Button
            type="text"
            icon={<SvgIcon name="settings" />}
            onClick={() => handleEdit(record)}
          />
          <Button
            type="text"
            danger
            icon={<SvgIcon name="delete" />}
            onClick={() => handleDelete(record)}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="p-6 h-full overflow-y-auto">
      <Spin spinning={isLoading}>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <Table
            columns={columns}
            dataSource={pipelines}
            rowKey="id"
            pagination={false}
            onRow={record => ({
              className: 'hover:bg-gray-50/30 transition-colors group',
            })}
          />

          {/* Add button */}
          <button
            className="w-full py-8 border-t border-gray-100 text-gray-400 hover:text-[#2563EB] hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            onClick={handleAddPipeline}
          >
            <SvgIcon name="plus" size={18} />
            <span className="font-medium text-sm">{t('pipeline.add_pipeline')}</span>
          </button>
        </div>
      </Spin>

      {/* Basic Info Dialog */}
      <PipelineBasicDialog
        open={basicDialogVisible}
        pipeline={basicDialogPipeline}
        pipelines={pipelines}
        onClose={() => setBasicDialogVisible(false)}
        onConfirm={handleBasicDialogConfirm}
      />

      {/* Detail Drawer */}
      {detailVisible && currentPipeline && (
        <PipelineDetail
          open={detailVisible}
          pipeline={currentPipeline}
          onClose={() => setDetailVisible(false)}
          onSave={handleSave}
          onEditBasic={handleEditBasic}
        />
      )}
    </div>
  )
}

export default DataPipeline
