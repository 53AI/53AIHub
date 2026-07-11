import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigationStore } from '@/stores/modules/navigation'
import { useIsSoftStyle } from '@/stores/modules/enterprise'
import Header from '@/components/Layout/Header'
import { Spin } from 'antd'
import './custom.css'

interface CustomViewProps {
  title?: string
}

export function CustomView({ title }: CustomViewProps) {
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [loading, setLoading] = useState(false)
  const [iframeContent, setIframeContent] = useState('')
  const [iframeHeight, setIframeHeight] = useState(200)
  const [iframeKey, setIframeKey] = useState(0)

  const navigationStore = useNavigationStore()
  const isSoftStyle = useIsSoftStyle()

  // 构建完整的 HTML 文档结构
  const buildIframeContent = useCallback((htmlContent: string) => {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          html, body {
            margin: 0;
            padding: 0;
          }
          body {
            padding: 8px !important;
            margin: 0 !important;
            box-sizing: border-box;
            font-family: sans-serif;
            font-size: 16px;
          }
          img {
            max-width: 100%;
            height: auto;
          }
          p {
            margin: 5px 0;
          }
          table {
            margin-bottom: 10px;
            border-collapse: collapse;
            display: table;
          }
          td, th {
            padding: 5px 10px;
            border: 1px solid #DDD;
          }
          th {
            border-top: 1px solid #BBB;
            background-color: #F7F7F7;
          }
          ol, ul {
            margin: 0;
            padding: 0;
            width: 95%;
          }
          li {
            clear: both;
          }
          pre {
            margin: .5em 0;
            padding: .4em .6em;
            border-radius: 8px;
            background: #f8f8f8;
          }
        </style>
      </head>
      <body>${htmlContent}</body>
    </html>
  `
  }, [])

  // 更新 iframe 内容
  const updateIframeFromRoute = useCallback(() => {
    const { pathname } = location
    const currentNavigation = navigationStore.navigations.find(
      (item) => item.menu_path === pathname || item.jump_path === pathname
    ) || {} as any

    const contentData = currentNavigation.content || {}
    const rawHtmlContent = contentData.html_content || ''

    // 清除之前的定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    setLoading(true)
    setIframeContent('')

    // 使用 setTimeout 模拟 nextTick
    setTimeout(() => {
      setIframeContent(buildIframeContent(rawHtmlContent))
      setIframeKey(prev => prev + 1)

      // 定时器监听 iframe 高度变化
      timerRef.current = setInterval(() => {
        const iframeDocument = iframeRef.current?.contentDocument
        if (iframeDocument) {
          const height = iframeDocument.documentElement.scrollHeight
          setIframeHeight(height)
        }
      }, 1000)
    }, 0)
  }, [location, navigationStore.navigations, buildIframeContent])

  useEffect(() => {
    updateIframeFromRoute()

    return () => {
      // 清理定时器
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [updateIframeFromRoute])

  const handleIframeLoad = () => {
    setLoading(false)
  }

  return (
    <>
      {isSoftStyle && (
        <Header title={title || ''} />
      )}
      <div className="custom-container flex-1 overflow-auto relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <Spin />
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={iframeKey}
          srcDoc={iframeContent}
          className="w-full border-none"
          style={{ height: `${iframeHeight}px` }}
          sandbox="allow-same-origin"
          onLoad={handleIframeLoad}
          title="Custom Content"
        />
      </div>
    </>
  )
}

export default CustomView
