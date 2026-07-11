import { Spin, Button, message } from 'antd'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'
import { useEffect, useState, useRef, useCallback } from 'react'
import { markdownPreview } from '@/components/Markdown/helper'
import loadLib from '@/utils/loadLib'
import { copyToClip } from '@km/shared-utils'

interface MarkdownViewerProps {
  url?: string
  content?: string
}

interface ViewerEvent {
  type: string
  data: any
}

export function MarkdownViewer({ url, content }: MarkdownViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resolvedContent, setResolvedContent] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const highlighterInstanceRef = useRef<any>(null)
  const eventCallbackRef = useRef<Event[]>([])

  const copyItem = {
    logo: '/viewer/images/copy.png',
    label: '复制',
    handler: (info: any) => {
      copyToClip(info.text).then(() => {
        message.success('已复制')
      })
    }
  }

  const loadHighlighter = useCallback(async () => {
    if (!previewRef.current) return
    await loadLib('highlighter')
    const win = window as any
    highlighterInstanceRef.current = new win.TextHighlighter({
      container: previewRef.current,
      enableAutoHighlight: false,
      enableManualHighlight: true,
      forceVirtualMode: true,
      menuItems: [copyItem],
      onSelectionChange: (text: string) => {
        window.dispatchEvent(new CustomEvent('selection-change', { detail: { text } }))
      }
    })
    // Process pending events
    eventCallbackRef.current.forEach(event => {
      viewerEvent(event)
    })
    eventCallbackRef.current = []
    highlighterInstanceRef.current.init()
  }, [])

  const handleMenuClick = (item: any, text: string) => {
    window.dispatchEvent(new CustomEvent('quick-command', { detail: { name: item.name, prompt: item.content, text } }))
  }

  const viewerEvent = useCallback((event: Event) => {
    if (!highlighterInstanceRef.current) {
      eventCallbackRef.current.push(event)
      return
    }
    const detail = (event as CustomEvent<ViewerEvent>).detail
    if (detail?.type === 'menu') {
      const menuItems = detail.data.map((item: any) => {
        return {
          logo: item.logo,
          label: item.name,
          handler: (e: any) => {
            handleMenuClick(item, e.text)
          }
        }
      })
      highlighterInstanceRef.current.updateMenuItems(menuItems, copyItem)
    }
    if (detail?.type === 'auto-select-enabled') {
      highlighterInstanceRef.current.updateAutoSelectEnabled(detail.data)
    }
  }, [])

  const loadFile = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      if (content) {
        setResolvedContent(content)
      } else {
        if (!url) {
          setResolvedContent('')
          setLoading(false)
          return
        }
        const response = await fetch(url)
        if (!response.ok) {
          setResolvedContent('')
        } else {
          const text = await response.text()
          setResolvedContent(text)
        }
      }

      setLoading(false)
    } catch (err) {
      console.error('Markdown 文件加载失败:', err)
      setError(err instanceof Error ? err.message : '文件加载失败')
      setLoading(false)
    }
  }, [url, content])

  useEffect(() => {
    loadFile()
  }, [loadFile])

  // Render markdown after loading completes and DOM is ready
  useEffect(() => {
    if (!loading && !error && previewRef.current && resolvedContent) {
      markdownPreview(previewRef.current, resolvedContent, {
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
  }, [loading, error, resolvedContent, loadHighlighter])

  // Listen to viewer events
  useEffect(() => {
    window.addEventListener('viewer-event', viewerEvent)
    return () => {
      window.removeEventListener('viewer-event', viewerEvent)
      if (highlighterInstanceRef.current) {
        highlighterInstanceRef.current.destroy()
      }
    }
  }, [viewerEvent])

  const handleRetry = () => {
    loadFile()
  }

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spin />
        <span className="ml-2 text-secondary">加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-center p-8">
        <WarningOutlined className="text-6xl text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-primary mb-2">文件加载失败</h3>
        <p className="text-disabled mb-4">{error}</p>
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-white">
      <div className="flex-1 overflow-auto">
        <div
          ref={previewRef}
          className="vditor-reset h-full p-6 bg-white markdown-preview-styles"
          style={{ lineHeight: 1.6 }}
        />
      </div>
    </div>
  )
}

export default MarkdownViewer
