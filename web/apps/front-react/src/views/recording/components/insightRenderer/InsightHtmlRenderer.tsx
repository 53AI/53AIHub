import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

interface InsightHtmlRendererProps {
  html: string
}

/**
 * Render a generated standalone page without allowing its CSS to affect the
 * host application. Scripts are intentionally not enabled in the sandbox.
 */
export function InsightHtmlRenderer({ html }: InsightHtmlRendererProps) {
  const [height, setHeight] = useState(640)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const measureHeight = useCallback(() => {
      const document = frameRef.current?.contentDocument
      if (!document) return
      const contentHeight = document.body?.clientHeight || 0
      if (contentHeight > 0) setHeight(Math.max(640, contentHeight + 8))
  }, [])

  useEffect(() => {
    window.addEventListener('resize', measureHeight)
    return () => window.removeEventListener('resize', measureHeight)
  }, [measureHeight])

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    measureHeight()
    frameRef.current?.contentDocument?.querySelector('body')?.style.setProperty('overflow-y', 'hidden')
  }, [measureHeight])

  return (
    <iframe
      ref={frameRef}
      title="决策洞察"
      aria-label="决策洞察页面"
      className="insight-html-frame overflow-hidden"
      srcDoc={html}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={handleLoad}
      style={{ height }}
    />
  )
}

export default InsightHtmlRenderer
