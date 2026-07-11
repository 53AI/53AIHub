import { useState, useEffect, useRef } from 'react'
import { Popover, Button, Tag, Empty, Pagination, message } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { ragJobApi } from '@/api/modules/rag-job'
import { useLibraryStore } from '@/stores/modules/library'
import { RAG_JOB_STATUS } from '@/constants/chunk'
import { t } from '@/locales'
import { formatFileSize } from '@km/shared-utils'
import './queue.css'

export enum QueueType {
  CONVERT = 'convert',
  INDEX = 'index',
  AI_GENERATE_INDEX = 'ai_generate_index'
}

const JobType: Record<QueueType, string> = {
  [QueueType.CONVERT]: 'document_conversion',
  [QueueType.INDEX]: 'reindex',
  [QueueType.AI_GENERATE_INDEX]: 'ai_generate_index'
}

interface QueueProps {
  type: QueueType
  onView?: (id: string) => void
}

const getQueueTitle = (type: QueueType): string => {
  switch (type) {
    case QueueType.CONVERT:
      return t('queue.convert_queue_title')
    case QueueType.INDEX:
      return t('queue.index_queue_title')
    case QueueType.AI_GENERATE_INDEX:
      return t('queue.ai_generate_queue_title')
    default:
      return ''
  }
}

export function LibraryQueue({ type, onView }: QueueProps) {
  const navigate = useNavigate()
  const libraryStore = useLibraryStore()
  const [visible, setVisible] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const loadQueue = async () => {
    const data = await ragJobApi.list({
      offset: (page - 1) * pageSize,
      limit: pageSize,
      type: JobType[type]
    })
    setList(data.jobs || [])
    setTotal(data.total || 0)
  }

  const startPolling = () => {
    stopPolling()
    const hasProcessing = list.some(
      (job) => job.status === RAG_JOB_STATUS.PENDING || job.status === RAG_JOB_STATUS.PROCESSING
    )
    if (hasProcessing) {
      timerRef.current = setInterval(loadQueue, 5000)
    }
  }

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const handleOpen = async () => {
    await loadQueue()
    setVisible(true)
    startPolling()
  }

  const handleClose = () => {
    setVisible(false)
    stopPolling()
    setList([])
    setTotal(0)
    setPage(1)
  }

  const handleCancel = async (jobId: number) => {
    try {
      await ragJobApi.cancel(jobId)
      await loadQueue()
      if (libraryStore.currentFileId) {
        libraryStore.loadFile(libraryStore.currentFileId, true)
      }
    } catch (error: any) {
      if (error?.response?.data?.data) {
        message.error(error.response.data.data)
      }
    }
  }

  const handleView = (fileId: string) => {
    const route = type === QueueType.CONVERT ? 'view' : 'chunks'
    navigate(`/library/${libraryStore.library_id}/file/${fileId}?tab=${route}`)
    onView?.(fileId)
    handleClose()
  }

  const getStatusTag = (status: string, jobType: string) => {
    switch (status) {
      case RAG_JOB_STATUS.PENDING:
        return <Tag color="blue">{t('queue.pending')}</Tag>
      case RAG_JOB_STATUS.PROCESSING:
        return (
          <Tag color="warning">
            <LoadingOutlined className="mr-1" />
            {getProcessingText(jobType)}
          </Tag>
        )
      case RAG_JOB_STATUS.SUCCESS:
        return (
          <span className="flex items-center">
            <CheckCircleFilled className="text-green-500 mr-1" />
            {getSuccessfulText(jobType)}
          </span>
        )
      case RAG_JOB_STATUS.FAILED:
        return (
          <span className="flex items-center">
            <CloseCircleFilled className="text-red-500 mr-1" />
            {getFailedText(jobType)}
          </span>
        )
      case RAG_JOB_STATUS.CANCELLED:
        return <Tag color="default">{t('queue.cancelled')}</Tag>
      default:
        return null
    }
  }

  const getProcessingText = (jobType: string) => {
    switch (jobType) {
      case 'document_conversion':
        return t('queue.converting')
      case 'rechunk_and_reindex':
        return t('queue.chunking')
      case 'reindex':
      case 'auto_chunking':
        return t('queue.indexing')
      case 'ai_generate_index':
        return t('queue.generating')
      default:
        return ''
    }
  }

  const getSuccessfulText = (jobType: string) => {
    switch (jobType) {
      case 'document_conversion':
        return t('queue.convert_successful')
      case 'rechunk_and_reindex':
        return t('queue.chunk_successful')
      case 'reindex':
      case 'auto_chunking':
        return t('queue.index_successful')
      case 'ai_generate_index':
        return t('queue.generate_successful')
      default:
        return ''
    }
  }

  const getFailedText = (jobType: string) => {
    switch (jobType) {
      case 'document_conversion':
        return t('queue.convert_failed')
      case 'rechunk_and_reindex':
        return t('queue.chunk_failed')
      case 'reindex':
      case 'auto_chunking':
        return t('queue.index_failed')
      case 'ai_generate_index':
        return t('queue.generate_failed')
      default:
        return ''
    }
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  useEffect(() => {
    if (visible) {
      loadQueue()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, visible])

  const content = (
    <div className="max-h-[35vh] overflow-y-auto min-w-[400px]">
      {list.length > 0 ? (
        list.map((item) => (
          <div key={item.id} className="flex justify-between py-2.5 mr-1 border-b last:border-b-0">
            <div className="flex-1 flex items-center overflow-hidden">
              <div className="flex-none mr-1.5">
                <img className="size-6" src={item.file_info?.icon || '/images/file.png'} alt="" />
              </div>
              <div className="flex flex-col justify-between">
                <div className="truncate text-sm">{item.file_info?.name}</div>
                <div className="text-xs text-[#999999]">
                  {item.file_info?.size && formatFileSize(item.file_info.size)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusTag(item.status, item.type)}
              {item.status === RAG_JOB_STATUS.PENDING && (
                <Button type="link" danger onClick={() => handleCancel(item.id)}>
                  {t('action.cancel')}
                </Button>
              )}
              {(item.status === RAG_JOB_STATUS.SUCCESS || item.status === RAG_JOB_STATUS.FAILED) && (
                <Button type="link" onClick={() => handleView(item.file_info?.id)}>
                  {t('queue.view')}
                </Button>
              )}
            </div>
          </div>
        ))
      ) : (
        <Empty description={t('common.no_data')} />
      )}
      {total > pageSize && (
        <div className="mt-4 flex justify-end">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            size="small"
            showSizeChanger
            showQuickJumper
            onChange={(p, ps) => {
              if (ps !== pageSize) {
                setPage(1)
                setPageSize(ps)
              } else {
                setPage(p)
              }
            }}
          />
        </div>
      )}
    </div>
  )

  return (
    <Popover
      open={visible}
      title={getQueueTitle(type)}
      content={content}
      trigger="click"
      placement="bottomRight"
      onOpenChange={(v) => !v && handleClose()}
    >
      <Button type="link" onClick={handleOpen}>
        {t('queue.view')}
      </Button>
    </Popover>
  )
}

export default LibraryQueue
