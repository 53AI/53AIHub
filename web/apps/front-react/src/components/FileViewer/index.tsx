import { useMemo } from 'react'
import { Button } from 'antd'
import { WarningOutlined, DownloadOutlined, CopyOutlined } from '@ant-design/icons'
import { message } from 'antd'
import { copyToClip, isKKFileViewSupported } from '@km/shared-utils'
import { lazy, Suspense } from 'react'
import { t } from '@/locales'
import './index.css'

// Lazy load viewers for better performance
const NormalViewer = lazy(() => import('./NormalViewer'))
const MarkdownViewer = lazy(() => import('./MarkdownViewer'))
const EpubViewer = lazy(() => import('./EpubViewer'))
const KKFileView = lazy(() => import('@/components/KKFileView'))

interface FileViewerProps {
  /** File URL */
  url?: string
  /** File content */
  content?: string
  /** File extension */
  extension?: string
  /** Auto load */
  autoLoad?: boolean
}

function LoadingFallback() {
  return (
    <div className="file-viewer-loading">
      <div className="loading-spinner" />
      <span>加载中...</span>
    </div>
  )
}

export function FileViewer({
  url,
  content,
  extension,
  autoLoad = true,
}: FileViewerProps) {
  const fileExtension = useMemo(() => {
    if (extension) return extension
    if (!url) return ''
    const pathname = url.split('?')[0].toLowerCase()
    const match = pathname.match(/\.([a-zA-Z0-9]+)(?:$|\/)/)
    return match ? match[1] : ''
  }, [url, extension])

  const fileName = useMemo(() => {
    if (!url) return '未知文件'
    const urlParts = url.split('/')
    return urlParts[urlParts.length - 1] || '未知文件'
  }, [url])

  const isMarkdownFile = useMemo(() => {
    return ['md'].includes(fileExtension)
  }, [fileExtension])

  const isEpubFile = useMemo(() => {
    return ['epub'].includes(fileExtension)
  }, [fileExtension])

  const isKKFile = useMemo(() => {
    return isKKFileViewSupported(fileExtension)
  }, [fileExtension])

  const isNormalFile = useMemo(() => {
    return ['html', 'htm', 'json', 'txt', 'xml', 'log'].includes(fileExtension)
  }, [fileExtension])

  const handleDownload = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleCopyUrl = async () => {
    if (!url) return
    try {
      await copyToClip(url)
      message.success('文件链接已复制到剪贴板')
    } catch (err) {
      message.error('复制失败')
    }
  }

  // Unsupported file type (not markdown, epub, KKFileView supported, or normal file)
  if (!isMarkdownFile && !isEpubFile && !isKKFile && !isNormalFile) {
    return (
      <div className="flex-1 file-viewer-unsupported">
        <WarningOutlined className="unsupported-icon" />
        <h3>不支持的文件类型</h3>
        <p>当前文件类型 {fileExtension} 暂不支持预览</p>
        <div className="unsupported-actions">
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
            下载文件
          </Button>
          <Button icon={<CopyOutlined />} onClick={handleCopyUrl}>
            {t('action.copy_link')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="file-viewer">
      <Suspense fallback={<LoadingFallback />}>
        {isMarkdownFile && (
          <MarkdownViewer url={url} content={content} />
        )}
        {isEpubFile && url && (
          <EpubViewer url={url} />
        )}
        {isKKFile && url && (
          <KKFileView url={url} />
        )}
        {isNormalFile && url && (
          <NormalViewer url={url} content={content} extension={fileExtension} />
        )}
      </Suspense>
    </div>
  )
}

export default FileViewer
