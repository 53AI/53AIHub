import { useEffect, useState } from 'react'
import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import WpsOffice from '@/components/WpsOffice'
import KKFileView from '@/components/KKFileView'
import FileViewer from '@/components/FileViewer'
import { FileItem } from '@/api/modules/files/types'
import { useFileMode } from '@/hooks/useFileMode'

interface ViewProps {
  currentFile: FileItem
  content?: string
}

function LoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spin />
    </div>
  )
}

export function FileViewerWrapper({ currentFile, content }: ViewProps) {
  const { officeType, wpsStatus, officeLoading, checkFileMode } = useFileMode()

  useEffect(() => {
    if (currentFile?.file_ext && currentFile?.library_id) {
      checkFileMode({
        file_ext: currentFile.file_ext,
        library_id: currentFile.library_id,
        type: 'preview'
      })
    }
  }, [currentFile?.file_ext, currentFile?.library_id, checkFileMode])

  if (officeLoading) {
    return <LoadingFallback />
  }

  if (officeType === 'wps' && wpsStatus.is_configured) {
    return (
      <WpsOffice
        fileId={currentFile.id}
        fileExt={currentFile.file_ext}
        appId={wpsStatus.app_id}
        readonly
      />
    )
  }

  if (officeType === 'kk') {
    return <KKFileView url={currentFile.file_url} />
  }

  return (
    <FileViewer
      content={content}
      extension={currentFile.file_ext}
      url={currentFile.file_url}
    />
  )
}

export default FileViewerWrapper
