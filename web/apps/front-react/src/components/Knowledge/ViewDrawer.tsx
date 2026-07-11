import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Drawer, Button, Spin } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import FileViewer from '@/components/FileViewer/View'
import type { FileItem } from '@/api/modules/files/types'
import filesApi from '@/api/modules/files'
import { formatFile } from '@/api/modules/files/transform'
import chunksApi from '@/api/modules/chunks'
import { buildUrl } from '@/utils/router'

export interface ViewDrawerRef {
  open: (data: { file_id: string }) => void
}

export interface ViewDrawerProps {
  onClose?: () => void
}

const ViewDrawer = forwardRef<ViewDrawerRef, ViewDrawerProps>(({
  onClose,
}, ref) => {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [currentFile, setCurrentFile] = useState<FileItem>({} as FileItem)
  const [fileContent, setFileContent] = useState('')

  const loadChunks = useCallback((id: string) => {
    return chunksApi.files.list(id).then((res) => {
      const content = res.chunks.map((item: any) => item.content).join('\n')
      setFileContent(content)
    })
  }, [])

  const loadFile = useCallback((id: string) => {
    return filesApi.get(id).then((res) => {
      const file = formatFile(res)
      setCurrentFile(file)
      if (!file.file_url && file.file_ext === 'md') {
        return loadChunks(id)
      }
    })
  }, [loadChunks])

  const handleView = useCallback(() => {
    const url = buildUrl(`/library/${currentFile.library_id}/file/${currentFile.id}`)
    window.open(url)
  }, [currentFile])

  const handleClose = useCallback(() => {
    // Clean up Blob URL to avoid memory leak
    if (currentFile.file_url && currentFile.file_url.startsWith('blob:')) {
      URL.revokeObjectURL(currentFile.file_url)
    }
    setFileContent('')
    setCurrentFile({} as FileItem)
    onClose?.()
  }, [currentFile, onClose])

  const open = useCallback((data: { file_id: string }) => {
    setLoading(true)
    setVisible(true)
    Promise.all([loadFile(data.file_id)]).finally(() => {
      setLoading(false)
    })
  }, [loadFile])

  useImperativeHandle(ref, () => ({
    open,
  }))

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentFile.file_url && currentFile.file_url.startsWith('blob:')) {
        URL.revokeObjectURL(currentFile.file_url)
      }
    }
  }, [])

  return (
    <Drawer
      open={visible}
      placement="left"
      size="large"
      className="knowledge-view-drawer"
      style={{ width: 'calc(100vw - 418px)' }}
      mask={false}
      destroyOnHidden
      onClose={() => {
        setVisible(false)
        handleClose()
      }}
      title={
        <div className="flex items-center gap-2">
          <div className="size-6 flex-shrink-0">
            {currentFile.icon && (
              <img className="size-6" src={currentFile.icon} alt="" />
            )}
          </div>
          <div className="flex-1 text-base text-gray-800 truncate">
            {currentFile.name || '--'}
          </div>
          {currentFile.id && (
            <Button type="link" className="mr-5" onClick={handleView}>
              查看文档
              <SvgIcon className="ml-1.5" name="share" size={14} />
            </Button>
          )}
        </div>
      }
    >
      <div className="h-full overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spin />
          </div>
        ) : (
          (currentFile.id || fileContent) && (
            <FileViewer
              currentFile={currentFile}
              content={fileContent}
            />
          )
        )}
      </div>
    </Drawer>
  )
})

ViewDrawer.displayName = 'ViewDrawer'

export default ViewDrawer