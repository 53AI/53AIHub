import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Button, Table, Spin, message } from 'antd'
import { WarningOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import loadLib from '@/utils/loadLib'
import { copyToClip } from '@km/shared-utils'
import './NormalViewer.css'

// 声明全局 TextHighlighter 类型
declare global {
  interface Window {
    TextHighlighter: any
  }
}

interface ViewerEventDetail {
  type: string
  data: any
}

interface NormalViewerProps {
  url: string
  content?: string
  extension?: string
}

// 复制菜单项配置
const copyItem = {
  logo: '/viewer/images/copy.png',
  label: '复制',
  handler: (info: any) => {
    copyToClip(info.text).then(() => {
      message.success('已复制')
    })
  }
}

// 生成唯一的作用域类名
const generateScopeClass = () => {
  return `html-viewer-container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// CSS 作用域化函数 - 给选择器添加前缀
function scopeCSS(css: string, scopeClass: string): string {
  if (!css) return ''

  // 移除注释
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')

  // 处理 @media, @supports 等嵌套规则
  const processNestedRules = (cssText: string): string => {
    return cssText.replace(
      /@(media|supports|container|layer)[^{]*\{([\s\S]*?)\}(?=\s*(?:@|$))/g,
      (match, _atRule, content) => {
        const scopedContent = processCSSRules(content)
        return match.replace(content, scopedContent)
      }
    )
  }

  // 处理普通 CSS 规则
  const processCSSRules = (cssText: string): string => {
    return cssText.replace(
      /([^{}@]*?)\{([^{}]*?)\}/g,
      (match, selector, rules) => {
        const trimmedSelector = selector.trim()

        // 跳过 @keyframes 和其他不需要作用域的 @ 规则
        if (
          trimmedSelector.startsWith('@keyframes') ||
          trimmedSelector.startsWith('@-webkit-keyframes') ||
          trimmedSelector.startsWith('@font-face') ||
          trimmedSelector.startsWith('@page')
        ) {
          return match
        }

        // 如果是 @规则但不在上面的列表中，保持原���
        if (trimmedSelector.startsWith('@')) {
          return match
        }

        // 分割多个选择器（用逗号分隔）
        const selectors = selector.split(',').map((sel) => {
          sel = sel.trim()
          if (!sel) return sel

          // 如果是 html 或 body 选择器，替换为作用域类
          if (sel === 'html' || sel === 'body' || sel === ':root') {
            return `.${scopeClass}`
          }

          // 如果选择器以 html、body 或 :root 开头，替换它们
          if (
            sel.startsWith('html ') ||
            sel.startsWith('html>') ||
            sel.startsWith('html.') ||
            sel.startsWith('html#') ||
            sel.startsWith('html[') ||
            sel.startsWith('html:')
          ) {
            sel = sel.replace(/^html/, `.${scopeClass}`)
            return sel
          }
          if (
            sel.startsWith('body ') ||
            sel.startsWith('body>') ||
            sel.startsWith('body.') ||
            sel.startsWith('body#') ||
            sel.startsWith('body[') ||
            sel.startsWith('body:')
          ) {
            sel = sel.replace(/^body/, `.${scopeClass}`)
            return sel
          }
          if (
            sel.startsWith(':root ') ||
            sel.startsWith(':root>') ||
            sel.startsWith(':root.') ||
            sel.startsWith(':root#') ||
            sel.startsWith(':root[') ||
            sel.startsWith(':root:')
          ) {
            sel = sel.replace(/^:root/, `.${scopeClass}`)
            return sel
          }

          // 处理通配符选择器
          if (sel === '*') {
            return `.${scopeClass} *`
          }

          // 给普通选择器添加作用域前缀
          return `.${scopeClass} ${sel}`
        })

        return `${selectors.join(', ')} { ${rules} }`
      }
    )
  }

  // 先处理嵌套规则
  let scopedCSS = processNestedRules(css)
  // 再处理普通规则
  scopedCSS = processCSSRules(scopedCSS)

  return scopedCSS
}

export default function NormalViewer({ url, content, extension }: NormalViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fileContent, setFileContent] = useState('')

  // 内容容器 refs
  const htmlRef = useRef<HTMLDivElement>(null)
  const jsonRef = useRef<HTMLPreElement>(null)
  const xmlRef = useRef<HTMLPreElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const csvRef = useRef<HTMLDivElement>(null)

  // CSS 作用域相关 refs
  const insertedStyleRef = useRef<HTMLStyleElement | null>(null)

  // 高亮器相关 refs
  const highlighterInstanceRef = useRef<any>(null)
  const eventCallbackRef = useRef<Event[]>([])

  // 生成唯一的作用域类名（组件级别保持不变）
  const scopeClass = useMemo(() => generateScopeClass(), [])
  const scopedStyleId = useMemo(() => `html-viewer-style-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, [])

  const fileType = useMemo(() => {
    if (extension) return extension
    const urlLower = url.toLowerCase()
    if (urlLower.includes('.html')) return 'html'
    if (urlLower.includes('.htm')) return 'htm'
    if (urlLower.includes('.json')) return 'json'
    if (urlLower.includes('.xml')) return 'xml'
    if (urlLower.includes('.csv')) return 'csv'
    if (urlLower.includes('.txt')) return 'txt'
    return 'unknown'
  }, [url, extension])

  const fileName = useMemo(() => {
    const urlParts = url.split('/')
    return urlParts[urlParts.length - 1] || '未知文件'
  }, [url])

  // 处理菜单点击
  const handleMenuClick = useCallback((item: any, text: string) => {
    window.dispatchEvent(
      new CustomEvent('quick-command', {
        detail: { name: item.name, prompt: item.content, text }
      })
    )
  }, [])

  // 处理 viewer-event 事件
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

  // 加载高亮器
  const loadHighlighter = useCallback(async () => {
    // 根据文件类型选择对应的容器
    let container: HTMLElement | null = null
    if ((fileType === 'html' || fileType === 'htm') && htmlRef.current) {
      container = htmlRef.current
    } else if (fileType === 'json' && jsonRef.current) {
      container = jsonRef.current
    } else if (fileType === 'xml' && xmlRef.current) {
      container = xmlRef.current
    } else if (fileType === 'txt' && textRef.current) {
      container = textRef.current
    } else if (fileType === 'csv' && csvRef.current) {
      container = csvRef.current
    }

    if (!container) return null

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
      container: container,
      enableAutoHighlight: false,
      enableManualHighlight: true,
      menuItems: [copyItem],
      onSelectionChange: (text: string) => {
        window.dispatchEvent(new CustomEvent('selection-change', { detail: { text } }))
      }
    })

    // 处理待执行的事件
    eventCallbackRef.current.forEach(event => viewerEvent(event))
    eventCallbackRef.current = []

    highlighterInstanceRef.current.init()
    return highlighterInstanceRef.current
  }, [fileType, viewerEvent])

  // Load file content
  useEffect(() => {
    const loadFile = async () => {
      if (!url) {
        setError('文件URL不能为空')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError('')

        if (content) {
          setFileContent(content)
        } else {
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          setFileContent(await response.text())
        }
      } catch (err) {
        console.error('文件加载失败:', err)
        setError(err instanceof Error ? err.message : '文件加载失败')
      } finally {
        setLoading(false)
      }
    }

    loadFile()
  }, [url, content])

  // 文件加载完成后初始化高亮器
  useEffect(() => {
    if (!loading && !error && fileContent) {
      // 延迟一下确保内容已渲染
      const timer = setTimeout(() => {
        loadHighlighter()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [loading, error, fileContent, loadHighlighter])

  // JSON highlighting
  const jsonContent = useMemo(() => {
    if (fileType !== 'json' || !fileContent) return ''

    try {
      const parsed = JSON.parse(fileContent)
      const formatted = JSON.stringify(parsed, null, 2)
      return highlightJson(formatted)
    } catch (e) {
      return highlightJson(fileContent)
    }
  }, [fileType, fileContent])

  // XML highlighting
  const xmlContent = useMemo(() => {
    if (fileType !== 'xml' || !fileContent) return ''

    try {
      const formatted = formatXML(fileContent)
      return highlightXml(formatted)
    } catch (e) {
      return highlightXml(fileContent)
    }
  }, [fileType, fileContent])

  // Text paragraphs
  const textParagraphs = useMemo(() => {
    if (fileType !== 'txt' || !fileContent) return []
    return fileContent.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0)
  }, [fileType, fileContent])

  // CSV parsing
  const { csvHeaders, csvData } = useMemo(() => {
    if (fileType !== 'csv' || !fileContent) return { csvHeaders: [], csvData: [] }

    try {
      const { headers, data } = parseCSV(fileContent)
      return { csvHeaders: headers, csvData: data }
    } catch (e) {
      console.error('CSV 解析失败:', e)
      return { csvHeaders: [], csvData: [] }
    }
  }, [fileType, fileContent])

  // HTML content sanitization with CSS scoping
  const sanitizedHtml = useMemo(() => {
    if ((fileType !== 'html' && fileType !== 'htm') || !fileContent) return ''
    return sanitizeHtmlWithScope(fileContent, scopeClass, scopedStyleId, insertedStyleRef)
  }, [fileType, fileContent, scopeClass, scopedStyleId])

  // 清理注入的样式和高亮器，添加事件监听
  useEffect(() => {
    window.addEventListener('viewer-event', viewerEvent)

    return () => {
      window.removeEventListener('viewer-event', viewerEvent)

      // 清理注入的样式
      if (insertedStyleRef.current && insertedStyleRef.current.parentNode) {
        insertedStyleRef.current.parentNode.removeChild(insertedStyleRef.current)
        insertedStyleRef.current = null
      }

      // 清理高亮器
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
  }, [viewerEvent])

  const handleRetry = () => {
    setLoading(true)
    setError('')
    setFileContent('')
    // Re-trigger load
  }

  const handleDownload = () => {
    const blob = new Blob([fileContent], { type: 'text/plain' })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  }

  if (loading) {
    return (
      <div className="normal-viewer-loading">
        <Spin size="large" />
        <span>加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="normal-viewer-error">
        <WarningOutlined className="error-icon" />
        <h3>文件加载失败</h3>
        <p>{error}</p>
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
          重试
        </Button>
      </div>
    )
  }

  // HTML preview
  if (fileType === 'html' || fileType === 'htm') {
    return (
      <div className="normal-viewer-content">
        <div
          ref={htmlRef}
          className={`html-content ${scopeClass}`}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
    )
  }

  // JSON content
  if (fileType === 'json') {
    return (
      <div className="normal-viewer-content">
        <pre ref={jsonRef} className="json-content">
          <code dangerouslySetInnerHTML={{ __html: jsonContent }} />
        </pre>
      </div>
    )
  }

  // XML content
  if (fileType === 'xml') {
    return (
      <div className="normal-viewer-content">
        <pre ref={xmlRef} className="xml-content">
          <code dangerouslySetInnerHTML={{ __html: xmlContent }} />
        </pre>
      </div>
    )
  }

  // CSV content
  if (fileType === 'csv') {
    const columns = csvHeaders.map((header, index) => ({
      title: header || `列 ${index + 1}`,
      dataIndex: `col_${index}`,
      key: `col_${index}`,
      ellipsis: true,
    }))

    return (
      <div ref={csvRef} className="normal-viewer-content csv-content">
        <Table
          columns={columns}
          dataSource={csvData}
          pagination={false}
          scroll={{ x: 'max-content', y: 600 }}
          size="small"
          bordered
        />
      </div>
    )
  }

  // Text content
  if (fileType === 'txt') {
    return (
      <div className="normal-viewer-content">
        <div ref={textRef} className="text-content">
          {textParagraphs.map((paragraph, index) => (
            <div key={index} className="text-paragraph">
              {paragraph}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Unsupported
  return (
    <div className="normal-viewer-unsupported">
      <WarningOutlined className="unsupported-icon" />
      <h3>不支持的文件类型</h3>
      <p>当前文件类型 {fileType} 暂不支持预览</p>
      <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
        下载文件
      </Button>
    </div>
  )
}

// Helper functions
function highlightJson(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-default'

      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key'
        } else {
          cls = 'json-string'
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean'
      } else if (/null/.test(match)) {
        cls = 'json-null'
      } else if (/^-?\d/.test(match)) {
        cls = 'json-number'
      }

      return `<span class="${cls}">${match}</span>`
    }
  )
}

function formatXML(xml: string): string {
  let formatted = ''
  let indent = 0
  const tab = '  '
  xml = xml.trim().replace(/>\s*</g, '><')

  for (let i = 0; i < xml.length; i++) {
    const char = xml[i]

    if (char === '<') {
      if (xml[i + 1] === '/') {
        indent--
        formatted += '\n' + tab.repeat(indent) + '<'
      } else {
        if (i > 0 && xml[i - 1] !== '>') {
          formatted += '\n' + tab.repeat(indent)
        }
        formatted += '<'
        if (xml[i + 1] !== '?' && xml[i + 1] !== '!' && xml[i + 1] !== '/') {
          indent++
        }
      }
    } else if (char === '>') {
      formatted += '>'
    } else {
      formatted += char
    }
  }

  return formatted.trim()
}

function highlightXml(xml: string): string {
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  let escaped = escapeHtml(xml)

  // Highlight CDATA
  escaped = escaped.replace(/&lt;!\[CDATA\[[\s\S]*?\]\]&gt;/g, (match) => {
    return `<span class="xml-cdata">${match}</span>`
  })

  // Highlight comments
  escaped = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, (match) => {
    return `<span class="xml-comment">${match}</span>`
  })

  // Highlight tags
  escaped = escaped.replace(
    /&lt;([\w\-:]+)(\s+[^&]*?)?(\s*\/?&gt;)/g,
    (_match, tagName, attrs, closing) => {
      const openTag = `<span class="xml-bracket">&lt;</span><span class="xml-tag">${tagName}</span>`

      if (attrs && attrs.trim()) {
        const highlightedAttrs = attrs.replace(
          /([\w\-:]+)\s*=\s*(["'])(.*?)\2/g,
          (_attrMatch, attrName, quote, attrValue) => {
            return ` <span class="xml-attr">${attrName}</span>=${quote}<span class="xml-value">${attrValue}</span>${quote}`
          }
        )
        return openTag + highlightedAttrs + `<span class="xml-bracket">${closing}</span>`
      }

      return openTag + `<span class="xml-bracket">${closing}</span>`
    }
  )

  return escaped
}

// HTML 内容清理函数（防止 XSS 攻击）并处理样式隔离
function sanitizeHtmlWithScope(
  html: string,
  scopeClass: string,
  scopedStyleId: string,
  insertedStyleRef: React.MutableRefObject<HTMLStyleElement | null>
): string {
  if (!html) return ''

  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // 移除所有 script 标签
  tempDiv.querySelectorAll('script').forEach((script) => script.remove())

  // 提取并处理所有 style 标签
  const styles = tempDiv.querySelectorAll('style')
  let collectedCSS = ''

  styles.forEach((style) => {
    const cssText = style.textContent || ''
    // 给 CSS 添加作用域
    const scopedCSS = scopeCSS(cssText, scopeClass)
    collectedCSS += scopedCSS + '\n'
    // 移除原始 style 标签
    style.remove()
  })

  // 如果有收集到的 CSS，插入到页面中
  if (collectedCSS) {
    // 先移除旧的样式元素
    if (insertedStyleRef.current && insertedStyleRef.current.parentNode) {
      insertedStyleRef.current.parentNode.removeChild(insertedStyleRef.current)
    }

    // 创建新的样式元素
    const styleElement = document.createElement('style')
    styleElement.id = scopedStyleId
    styleElement.textContent = collectedCSS
    document.head.appendChild(styleElement)
    insertedStyleRef.current = styleElement
  }

  // 移除外部样式表链接（避免样式污染）
  tempDiv.querySelectorAll('link[rel="stylesheet"]').forEach((link) => link.remove())

  // 移除危险标签
  const dangerousTags = ['iframe', 'object', 'embed', 'form', 'input', 'button']
  dangerousTags.forEach((tag) => {
    tempDiv.querySelectorAll(tag).forEach((el) => el.remove())
  })

  // 移除所有元素上的事件处理器属性
  tempDiv.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      // 移除所有以 on 开头的事件处理器（onclick, onerror 等）
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name)
      }
      // 移除 javascript: URL
      if (attr.value && attr.value.toLowerCase().startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
      // 移除 data: URL（可能包含恶意脚本）
      if (attr.value && attr.value.toLowerCase().startsWith('data:text/html')) {
        el.removeAttribute(attr.name)
      }
    })

    // 特别处理 href 和 src 属性
    if (el.hasAttribute('href')) {
      const href = el.getAttribute('href')
      if (href && (href.toLowerCase().startsWith('javascript:') || href.toLowerCase().startsWith('data:text/html'))) {
        el.removeAttribute('href')
      }
    }

    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src')
      if (src && (src.toLowerCase().startsWith('javascript:') || src.toLowerCase().startsWith('data:text/html'))) {
        el.removeAttribute('src')
      }
    }

    // 移除 style 属性中的 expression 和 javascript
    if (el.hasAttribute('style')) {
      const styleValue = el.getAttribute('style') || ''
      if (styleValue.toLowerCase().includes('expression') || styleValue.toLowerCase().includes('javascript:')) {
        el.removeAttribute('style')
      }
    }
  })

  return tempDiv.innerHTML
}

function parseCSV(csvText: string): { headers: string[]; data: Record<string, string>[] } {
  const lines: string[] = []
  let currentLine = ''
  let inQuotes = false

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i]
    const nextChar = csvText[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentLine += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(currentLine)
      currentLine = ''
    } else if (char !== '\r' || inQuotes) {
      currentLine += char
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  if (lines.length === 0) {
    return { headers: [], data: [] }
  }

  const headers = parseCSVLine(lines[0])
  const data = lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, colIndex) => {
      row[`col_${colIndex}`] = values[colIndex] || ''
    })
    return row
  })

  return { headers, data }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}
