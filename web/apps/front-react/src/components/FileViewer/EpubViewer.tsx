import { useState, useEffect, useRef } from 'react'
import { Button, Spin } from 'antd'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'
import './EpubViewer.css'

interface EpubViewerProps {
  url: string
}

export default function EpubViewer({ url }: EpubViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const loadEpub = async () => {
      if (!url) {
        setError('文件URL不能为空')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError('')
        // For EPUB files, we use an iframe with a specialized viewer
        // In production, you might use epub.js library
        // Here we just show a placeholder for the EPUB viewer
        setLoading(false)
      } catch (err) {
        console.error('EPUB 文件加载失败:', err)
        setError(err instanceof Error ? err.message : '文件加载失败')
        setLoading(false)
      }
    }

    loadEpub()
  }, [url])

  const handleRetry = () => {
    setLoading(true)
    setError('')
  }

  if (loading) {
    return (
      <div className="epub-viewer-loading">
        <Spin size="large" />
        <span>加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="epub-viewer-error">
        <WarningOutlined className="error-icon" />
        <h3>文件加载失败</h3>
        <p>{error}</p>
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
          重试
        </Button>
      </div>
    )
  }

  // For EPUB, we would typically use epub.js library
  // This is a placeholder implementation
  return (
    <div className="epub-viewer">
      <div className="epub-placeholder">
        <div className="epub-icon">📚</div>
        <h3>EPUB 预览</h3>
        <p>EPUB 文件预览需要集成 epub.js 库</p>
        <p className="epub-url">文件: {url.split('/').pop()}</p>
        <Button type="primary" href={url} target="_blank">
          下载阅读
        </Button>
      </div>
    </div>
  )
}
