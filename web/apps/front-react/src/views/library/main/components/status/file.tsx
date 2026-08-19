import { useMemo } from 'react'
import { Tooltip } from 'antd'
import { CloseCircleFilled } from '@ant-design/icons'
import { RUN_STATUS } from '@/constants/chunk'
import { SvgIcon } from '@km/shared-components-react'
import { t } from '@/locales'
import './file.css'

// 获取步骤名称（运行时翻译）
export const STEP_KEY_TO_NAME: Record<string, string> = {
  document_parsing: t('data_pipeline.node_document_parsing'),
  content_cleaning: t('data_pipeline.node_content_cleaning'),
  summary_generation: t('data_pipeline.node_summary_generation'),
  document_chunking: t('data_pipeline.node_document_chunking'),
  vector_indexing: t('data_pipeline.node_vector_indexing'),
  graph_generation: t('data_pipeline.node_graph_generation'),
  wiki_page_generation: t('data_pipeline.node_wiki_page_generation'),
}

interface FileStatusProps {
  status?: string
  stepKey?: string
  stepMode?: string
  plain?: boolean
  disabled?: boolean
  children?: React.ReactNode
  afterSlot?: React.ReactNode
}

export function FileStatus({
  status = '',
  stepKey = '',
  stepMode = '',
  plain = false,
  disabled = false,
  children,
  afterSlot
}: FileStatusProps) {
  const stepName = useMemo(() => {
    return stepKey ? STEP_KEY_TO_NAME[stepKey] : ''
  }, [stepKey])

  if (disabled) {
    return <>{children}</>
  }

  
  if (stepMode === 'auto' && status === RUN_STATUS.WAITING) {
    status = RUN_STATUS.PENDING
  }

  // Pending status
  if (status === RUN_STATUS.PENDING) {
    return (
      <div
        className={`flex-none h-8 flex items-center gap-2 rounded text-[#7948EA] ${plain ? '' : 'px-2.5 bg-[#F4F0FF]'}`}
      >
        <Tooltip title="排队中" placement="top" open={plain ? undefined : false}>
          <div className="flex-none size-4 flex items-center justify-center">
            <SvgIcon name="list-success" size={16} />
          </div>
        </Tooltip>
        {!plain && <span className="text-sm">{stepName || '文档解析'}排队</span>}
        {afterSlot}
      </div>
    )
  }

  // Processing status
  if (status === RUN_STATUS.PROCESSING) {
    return (
      <div
        className={`flex-none h-8 flex items-center gap-2 rounded text-[#2563EB] ${plain ? '' : 'px-2.5 bg-[#F0F5FF]'}`}
      >
        <Tooltip title="处理中" placement="top" open={plain ? undefined : false}>
          <div className="flex-none size-4 flex items-center justify-center animate-spin">
            <SvgIcon name="refresh" size={16} />
          </div>
        </Tooltip>
        {!plain && <span className="text-sm">{stepName || '文档解析'}中</span>}
        {afterSlot}
      </div>
    )
  }

  // Waiting status
  if (status === RUN_STATUS.WAITING) {
    return (
      <div
        className={`flex-none h-8 flex items-center gap-2 rounded text-[#FF8D1A] ${plain ? '' : 'px-2.5 bg-[#FFFAF5]'}`}
      >
        <Tooltip title="等待处理" placement="top" open={plain ? undefined : false}>
          <div className="flex-none size-4 flex items-center justify-center">
            <SvgIcon name="five-five" size={16} />
          </div>
        </Tooltip>
        {!plain && (
          <span className="text-sm">{stepName ? '手动' + stepName : '等待处理'}</span>
        )}
        {afterSlot}
      </div>
    )
  }

  // Failed status
  if (status === RUN_STATUS.FAILED) {
    return (
      <div
        className={`flex-none h-8 flex items-center gap-2 rounded ${plain ? '' : 'px-2.5 bg-[#FFEDED]'}`}
      >
        <Tooltip title="失败/中断" placement="top" open={plain ? undefined : false}>
          <CloseCircleFilled style={{ color: '#FA5151' }} />
        </Tooltip>
        {!plain && <span className="text-sm text-[#FA5151]">{stepName}失败</span>}
        {afterSlot}
      </div>
    )
  }

  // Default slot
  return <>{children}</>
}

export default FileStatus
