import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import WpsOffice from '@/components/WpsOffice'
import FileViewer from '@/components/FileViewer'
import { useOfficeViewer } from '@/hooks/useOfficeViewer'
import type { FileItem } from '@/api/modules/files/types'

interface ViewProps {
  currentFile: FileItem
  content?: string
}

export function FileViewerView({ currentFile, content }: ViewProps) {
  const { officeType, wpsStatus, officeLoading, checkOfficeViewer } = useOfficeViewer()

  useEffect(() => {
    checkOfficeViewer({
      file_ext: currentFile.file_ext,
      library_id: currentFile.library_id,
      type: 'preview',
    })
  }, [currentFile.file_ext, currentFile.library_id, checkOfficeViewer])

  if (officeLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin />
      </div>
    )
  }

  if (officeType === 'wps' && wpsStatus.app_id) {
    return (
      <WpsOffice
        fileId={currentFile.id}
        fileExt={currentFile.file_ext}
        appId={wpsStatus.app_id}
        readonly
      />
    )
  }

  return <FileViewer content={content} url={currentFile.file_url} />
}

export default FileViewerView
