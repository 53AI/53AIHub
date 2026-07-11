import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Spin, message } from 'antd'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'
import { markdownPreview } from '@/components/Markdown/helper'
import loadLib from '@/utils/loadLib'
import { copyToClip } from '@km/shared-utils'
import './MarkdownViewer.css'

// 声明全局 TextHighlighter 类型
declare global {
  interface Window {
    TextHighlighter: any
  }
}

interface MarkdownViewerProps {
  url?: string
  content?: string
}

interface ViewerEventDetail {
  type: 'menu' | 'auto-select-enabled'
  data: any
}

// 提取到组件外部，避免每次渲染重新创建
const copyItem = {
  logo: '/viewer/images/copy.png',
  label: '复制',
  handler: (info: any) => {
    copyToClip(info.text).then(() => {
      message.success('已复制')
    })
  }
}

export default function MarkdownViewer({ url, content }: MarkdownViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [markdownContent, setMarkdownContent] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const highlighterInstanceRef = useRef<any>(null)
  const eventCallbackRef = useRef<Event[]>([])
  const renderTimerRef = useRef<number | null>(null)
  const renderSeqRef = useRef(0)

  const handleMenuClick = useCallback((item: any, text: string) => {
    window.dispatchEvent(new CustomEvent('quick-command', {
      detail: { name: item.name, prompt: item.content, text }
    }))
  }, [])

  const viewerEvent = useCallback((event: Event) => {
    const detail = (event as CustomEvent<ViewerEventDetail>).detail

    if (!highlighterInstanceRef.current) {
      eventCallbackRef.current.push(event)
      return
    }

    if (detail.type === 'menu') {
      const menuItems = detail.data.map((item: any) => ({
        logo: item.logo,
        label: item.name,
        handler: (e: any) => handleMenuClick(item, e.text)
      }))
      highlighterInstanceRef.current.updateMenuItems(menuItems, copyItem)
    }

    if (detail.type === 'auto-select-enabled') {
      highlighterInstanceRef.current.updateAutoSelectEnabled(detail.data)
    }
  }, [handleMenuClick])

  const loadHighlighter = useCallback(async () => {
    if (!previewRef.current) return null

    await loadLib('highlighter')

    // 销毁旧实例
    if (highlighterInstanceRef.current) {
      try {
        highlighterInstanceRef.current.destroy()
      } catch (e) {
        console.error('销毁高亮器失败:', e)
      }
      highlighterInstanceRef.current = null
    }

    highlighterInstanceRef.current = new window.TextHighlighter({
      container: previewRef.current,
      enableAutoHighlight: false,
      enableManualHighlight: true,
      forceVirtualMode: true,
      menuItems: [copyItem],
      onSelectionChange: (text: string) => {
        window.dispatchEvent(new CustomEvent('selection-change', { detail: { text } }))
      }
    })

    // 处理积压的事件
    eventCallbackRef.current.forEach(event => viewerEvent(event))
    eventCallbackRef.current = []

    highlighterInstanceRef.current.init()
    return highlighterInstanceRef.current
  }, [viewerEvent])

  const loadFile = useCallback(async () => {
    setLoading(true)
    setError('')
    renderSeqRef.current += 1
    if (renderTimerRef.current != null) {
      window.clearTimeout(renderTimerRef.current)
      renderTimerRef.current = null
    }
    if (previewRef.current) {
      previewRef.current.innerHTML = ''
    }

    try {
      let mdContent = ''

      if (content) {
        mdContent = content
      } else if (url) {
        const response = await fetch(url)
        if (response.ok) {
          mdContent = await response.text()
        } else {
          mdContent = ''
        }
      } else {
        setError('文件URL不能为空')
        return
      }

      setMarkdownContent(mdContent)

      // 等待 DOM 更新后渲染
      const renderSeq = renderSeqRef.current
      renderTimerRef.current = window.setTimeout(async () => {
        renderTimerRef.current = null
        if (renderSeqRef.current !== renderSeq) return
        if (previewRef.current && mdContent) {
          previewRef.current.innerHTML = ''
          await markdownPreview(previewRef.current, mdContent, {
            mode: 'light',
            hljs: {
              lineNumber: true,
              style: 'github'
            },
            math: {
              inlineDigit: true,
              macros: {}
            },
            after: () => {
              loadHighlighter()
            }
          })
        }
      }, 100)
    } catch (err) {
      console.error('Markdown 文件加载失败:', err)
      setError(err instanceof Error ? err.message : '文件加载失败')
    } finally {
      setLoading(false)
    }
  }, [url, content, loadHighlighter])

  const handleRetry = useCallback(() => {
    loadFile()
  }, [loadFile])

  useEffect(() => {
    window.addEventListener('viewer-event', viewerEvent)
    loadFile()

    return () => {
      window.removeEventListener('viewer-event', viewerEvent)
      renderSeqRef.current += 1
      if (renderTimerRef.current != null) {
        window.clearTimeout(renderTimerRef.current)
        renderTimerRef.current = null
      }
      if (highlighterInstanceRef.current) {
        try {
          highlighterInstanceRef.current.destroy()
        } catch (e) {
          console.error('销毁高亮器失败:', e)
        }
        highlighterInstanceRef.current = null
      }
      eventCallbackRef.current = []
    }
  }, [viewerEvent, loadFile])

  if (loading) {
    return (
      <div className="markdown-viewer-loading">
        <Spin size="large" />
        <span>加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="markdown-viewer-error">
        <WarningOutlined className="error-icon" />
        <h3>文件加载失败</h3>
        <p>{error}</p>
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="markdown-viewer-root h-full w-full overflow-hidden bg-white">
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-auto">
          <div ref={previewRef} className="markdown-viewer-content vditor-reset p-6" />
        </div>
      </div>
    </div>
  )
}
