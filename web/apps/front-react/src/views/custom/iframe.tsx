import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Spin } from 'antd'
import './iframe.css'

interface WebViewProps {
  jumpPath?: string
}

export function WebView({ jumpPath }: WebViewProps) {
  const [searchParams] = useSearchParams()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)

  // 优先使用 URL 参数，其次使用 jumpPath
  const url = searchParams.get('url') || jumpPath || ''

  useEffect(() => {
    if (url) {
      setLoading(true)
    }
  }, [url])

  const handleIframeLoad = () => {
    setLoading(false)
  }

  if (!url) {
    return (
      <div className="iframe-container flex-1 flex items-center justify-center">
        <p className="text-gray-500">请提供有效的URL</p>
      </div>
    )
  }

  return (
    <div className="iframe-container flex-1 overflow-auto relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <Spin />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={url}
        className="w-full h-full border-none"
        title="Web View"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-pointer-lock allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads allow-modals allow-orientation-lock allow-presentation"
        onLoad={handleIframeLoad}
      />
    </div>
  )
}

export default WebView
