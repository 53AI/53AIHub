import { Drawer, Button, Spin } from 'antd'
import { useEffect, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { SvgIcon } from '@km/shared-components-react'
import FileViewer from '@/components/FileViewer/view'
import { FileItem } from '@/api/modules/files/types'
import filesApi from '@/api/modules/files'
import { formatFile } from '@/api/modules/files/transform'
import chunksApi from '@/api/modules/chunks'
import { useEnv } from '@/hooks/useEnv'

interface KnowledgeViewDrawerProps {
  onClose?: () => void
}

export interface KnowledgeViewDrawerRef {
  open: (data: { file_id: string }) => void
}

function KnowledgeViewDrawerInner(
  props: KnowledgeViewDrawerProps,
  ref: React.ForwardedRef<KnowledgeViewDrawerRef>
) {
  const { onClose } = props

  const { buildFrontLibraryFileUrl } = useEnv()

  const [visible, setVisible] = useState(false)
  const [currentFile, setCurrentFile] = useState<FileItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [fileContent, setFileContent] = useState('')

  // 使用 ref 跟踪当前文件，用于清理
  const currentFileRef = useRef<FileItem | null>(null)

  // 同步 currentFile 到 ref
  useEffect(() => {
    currentFileRef.current = currentFile
  }, [currentFile])

  const loadChunks = async (id: string) => {
    const res = await chunksApi.files.list(id)
    const content = res.chunks.map((item: any) => item.content).join('\n')
    setFileContent(content)
  }

  const loadFile = async (id: string) => {
    const res = await filesApi.get(id)
    const file = formatFile(res)
    setCurrentFile(file)
    if (!file.file_url && file.file_ext === 'md') {
      await loadChunks(id)
    }
  }

  const handleView = () => {
    if (currentFile) {
      window.open(buildFrontLibraryFileUrl(currentFile.library_id, currentFile.id))
    }
  }

  const handleClose = () => {
    // Clean up Blob URL（与 Vue 对齐）
    if (currentFile?.file_url?.startsWith('blob:')) {
      URL.revokeObjectURL(currentFile.file_url)
    }
    setFileContent('')
    setCurrentFile(null)
    setVisible(false)
    onClose?.()
  }

  const open = async (data: { file_id: string }) => {
    setLoading(true)
    setVisible(true)
    try {
      await loadFile(data.file_id)
    } finally {
      setLoading(false)
    }
  }

  // 暴露 ref 方法（与 Vue defineExpose 对齐）
  useImperativeHandle(ref, () => ({
    open,
  }))

  // 组件卸载时清理 Blob URL（与 Vue onUnmounted 对齐）
  useEffect(() => {
    return () => {
      if (currentFileRef.current?.file_url?.startsWith('blob:')) {
        URL.revokeObjectURL(currentFileRef.current.file_url)
      }
    }
  }, [])

  return (
    <Drawer
      open={visible}
      onClose={handleClose}
      placement="start"
      mask={false}
      destroyOnHidden
      title={
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 flex-shrink-0">
            {currentFile?.icon && <img className="w-6 h-6" src={currentFile.icon} alt="" />}
          </div>
          <div className="flex-1 text-base text-primary truncate">
            {currentFile?.name || '--'}
          </div>
          {currentFile?.id && (
            <Button type="link" className="mr-5" onClick={handleView}>
              查看文档
              <SvgIcon className="ml-1.5" name="share" size="14" />
            </Button>
          )}
        </div>
      }
      styles={{
        wrapper: { width: 'calc(100vw - 418px)' },
        body: { padding: 0 },
        header: { padding: '16px 24px' },
      }}
      className="knowledge-view-drawer"
      rootClassName="knowledge-view-modal"
    >
      <Spin spinning={loading} className="h-full">
        {(currentFile?.id || fileContent) && (
          <FileViewer currentFile={currentFile} content={fileContent} />
        )}
      </Spin>
    </Drawer>
  )
}

export const KnowledgeViewDrawer = forwardRef<KnowledgeViewDrawerRef, KnowledgeViewDrawerProps>(
  KnowledgeViewDrawerInner
)

export default KnowledgeViewDrawer
