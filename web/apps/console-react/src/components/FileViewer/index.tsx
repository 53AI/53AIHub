import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button, message, Spin } from 'antd'
import { WarningOutlined, DownloadOutlined, CopyOutlined } from '@ant-design/icons'
import { copyToClip } from '@km/shared-utils'
import { t } from '@/locales'

import OfficeViewer from './office-viewer'
import MarkdownViewer from './markdown-viewer'
import EpubViewer from './epub-viewer'
import NormalViewer from './normal-viewer'

interface FileViewerProps {
  /** 文件URL */
  url?: string
  /** 文件内容 */
  content?: string
  /** 文件扩展名 */
  extension?: string
  /** 是否自动加载 */
  autoLoad?: boolean
}

export function FileViewer({ url, content, extension, autoLoad = true }: FileViewerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Get file extension
  const fileExtension = useMemo(() => {
    if (extension) return extension
    if (!url) return ''
    const lowerUrl = url.toLowerCase()
    const match = lowerUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
    return match ? match[1] : ''
  }, [url, extension])

  // Get file name
  const fileName = useMemo(() => {
    if (!url) return t('unknown_file')
    const parts = url.split('/')
    return parts[parts.length - 1] || t('unknown_file')
  }, [url])

  // File type checks
  const isOfficeFile = useMemo(() => {
    const ext = fileExtension
    return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'].includes(ext)
  }, [fileExtension])

  const isMarkdownFile = useMemo(() => {
    return ['md'].includes(fileExtension)
  }, [fileExtension])

  const isEpubFile = useMemo(() => {
    return ['epub'].includes(fileExtension)
  }, [fileExtension])

  const isNormalFile = useMemo(() => {
    const ext = fileExtension
    return (
      ['html', 'htm', 'json', 'txt', 'xml', 'csv', 'log'].includes(ext) ||
      ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)
    )
  }, [fileExtension])

  // Validate URL
  const validateUrl = useCallback((urlToValidate: string): boolean => {
    try {
      new URL(urlToValidate)
      return true
    } catch {
      return false
    }
  }, [])

  // Load file
  const loadFile = useCallback(async () => {
    if (!url) {
      setError('文件URL不能为空')
      return
    }

    if (!validateUrl(url)) {
      setError('无效的文件URL')
      return
    }

    try {
      setLoading(true)
      setError('')
      // For Office files, no need to preload content
      if (isOfficeFile) {
        setLoading(false)
      }
    } catch (err) {
      console.error('文件验证失败:', err)
      setError(err instanceof Error ? err.message : '文件验证失败')
    } finally {
      setLoading(false)
    }
  }, [url, isOfficeFile, validateUrl])

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = url || ''
    a.download = fileName
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleCopyUrl = async () => {
    try {
      await copyToClip(url || '')
      message.success('文件链接已复制到剪贴板')
    } catch {
      message.error('复制失败')
    }
  }

  // Watch URL changes
  useEffect(() => {
    if (autoLoad) {
      loadFile()
    }
  }, [url, autoLoad, loadFile])

  // Show loading
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin />
      </div>
    )
  }

  // Show error
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <WarningOutlined className="text-6xl text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-primary mb-2">文件验证失败</h3>
        <p className="text-disabled mb-4">{error}</p>
        <Button type="primary" onClick={loadFile}>
          重试
        </Button>
      </div>
    )
  }

  // Office files (Word, Excel, PowerPoint, PDF)
  if (isOfficeFile && url) {
    return <OfficeViewer url={url} />
  }

  // Markdown files
  if (isMarkdownFile) {
    return <MarkdownViewer url={url} content={content} />
  }

  // EPUB files
  if (isEpubFile && url) {
    return <EpubViewer url={url} />
  }

  // Normal files (HTML, JSON, TXT, images, etc.)
  if (isNormalFile && url) {
    return <NormalViewer url={url} content={content} />
  }

  // Unsupported file type
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-center p-8">
      <WarningOutlined className="text-6xl text-orange-500 mb-4" />
      <h3 className="text-lg font-medium text-primary mb-2">不支持的文件类型</h3>
      <p className="text-disabled mb-4">
        当前文件类型 {fileExtension} 暂不支持预览
      </p>
      <div className="flex gap-2">
        <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
          下载文件
        </Button>
        <Button icon={<CopyOutlined />} onClick={handleCopyUrl}>
          复制链接
        </Button>
      </div>
    </div>
  )
}

export default FileViewer
