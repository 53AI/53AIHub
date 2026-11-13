import { useCallback, useEffect, useRef, useState } from 'react'

interface InsightHtmlRendererProps {
  html: string
}

const MIN_HEIGHT = 640
// 预留空间：body 默认外边距等不计入元素高度的部分 + 视觉呼吸空间
const HEIGHT_PADDING = 68
// 视为「占满视口」的误差容忍值（px）
const EQUAL_TOLERANCE = 1
// 不参与内容测量的标签（sandbox 下 script 不执行，但元素仍在 DOM 里）
const NON_CONTENT_TAGS = ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']

/**
 * Render a generated standalone page without allowing its CSS to affect the
 * host application. Scripts are intentionally not enabled in the sandbox.
 */
export function InsightHtmlRenderer({ html }: InsightHtmlRendererProps) {
  const [height, setHeight] = useState(MIN_HEIGHT)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // 最近一次应用的高度：内容高度为 0（空文档）时用于回退展示
  const heightRef = useRef(MIN_HEIGHT)
  const observerRef = useRef<ResizeObserver | null>(null)

  const applyHeight = useCallback((next: number) => {
    if (next === heightRef.current) return
    heightRef.current = next
    if (frameRef.current) frameRef.current.style.height = `${next}px`
    setHeight(next)
  }, [])

  /**
   * 测量内容自然高度。
   * 生成页面通常是单个根 div 包裹全部内容，优先以该唯一子元素为测量目标：
   * 其高度就是内容自然高度，不随 iframe 视口被 html,body{height:100%} 或
   * min-height:100vh 撑开。若唯一子元素恰好占满当前视口（自身被 100vh 拉伸），
   * 维持现状，避免「测量 → 撑高 → 再测量」的 +68px 增长回路。
   * body 无唯一内容子元素（空/多子元素）时，兜底归零视口后量 body。
   */
  const measureHeight = useCallback(() => {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    const body = doc?.body
    if (!frame || !doc || !body) return

    // body 有且仅有一个内容子元素：直接量这个元素
    const contentChildren = Array.from(body.children).filter(
      (el) => !NON_CONTENT_TAGS.includes(el.tagName)
    )
    if (contentChildren.length === 1) {
      const child = contentChildren[0] as HTMLElement
      const childHeight = Math.max(child.scrollHeight, child.offsetHeight)
      const frameHeight = frame.clientHeight
      if (Math.abs(childHeight - frameHeight) <= EQUAL_TOLERANCE) {
        // 唯一子元素占满视口（min-height:100vh/height:100% 拉伸）或恰好等高：维持现状
        return
      }
      applyHeight(Math.max(MIN_HEIGHT, childHeight + HEIGHT_PADDING))
      return
    }

    // 兜底：归零视口（绕过 CSS min-height）后量 body 自然高度
    frame.style.minHeight = '0px'
    frame.style.height = '0px'
    // 先读一次外层布局，确保 iframe 视口归零已同步到内层文档，避免量到旧值
    void frame.clientHeight
    const contentHeight = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      doc.documentElement.scrollHeight
    )
    const next =
      contentHeight > 0 ? Math.max(MIN_HEIGHT, contentHeight + HEIGHT_PADDING) : heightRef.current
    heightRef.current = next
    frame.style.height = `${next}px`
    frame.style.minHeight = ''
    if (contentHeight > 0) setHeight(next)
  }, [applyHeight])

  /**
   * 监听 iframe body 的尺寸变化（窗口 resize 引起的换行、图片加载后撑高等），
   * 替代原先只监听 window resize 的方式；测量已与视口解耦，不会再形成增长回路。
   */
  const observeBody = useCallback(() => {
    if (typeof ResizeObserver === 'undefined') return
    const body = frameRef.current?.contentDocument?.body
    if (!body) return
    observerRef.current?.disconnect()
    const observer = new ResizeObserver(() => measureHeight())
    observer.observe(body)
    observerRef.current = observer
  }, [measureHeight])

  const handleLoad = useCallback(() => {
    frameRef.current?.contentDocument
      ?.querySelector('body')
      ?.style.setProperty('overflow-y', 'hidden')
    measureHeight()
    observeBody()
  }, [measureHeight, observeBody])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

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
