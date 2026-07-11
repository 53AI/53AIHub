import { Spin, Button, Table } from 'antd'
import { WarningOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons'
import { useEffect, useState, useMemo } from 'react'

interface NormalViewerProps {
  url: string
  content?: string
}

export function NormalViewer({ url, content }: NormalViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fileContent, setFileContent] = useState('')

  const fileType = useMemo(() => {
    if (!url) return ''
    const lowerUrl = url.toLowerCase()
    if (lowerUrl.includes('.html') || lowerUrl.includes('.htm')) return 'html'
    if (lowerUrl.includes('.json')) return 'json'
    if (lowerUrl.includes('.xml')) return 'xml'
    if (lowerUrl.includes('.csv')) return 'csv'
    if (lowerUrl.includes('.txt')) return 'txt'
    return 'unknown'
  }, [url])

  const fileName = useMemo(() => {
    if (!url) return ''
    const parts = url.split('/')
    return parts[parts.length - 1] || '未知文件'
  }, [url])

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

  useEffect(() => {
    loadFile()
  }, [url, content])

  // JSON highlight
  const jsonContent = useMemo(() => {
    if (fileType !== 'json') return ''
    try {
      const parsed = JSON.parse(fileContent)
      return highlightJson(JSON.stringify(parsed, null, 2))
    } catch {
      return highlightJson(fileContent)
    }
  }, [fileType, fileContent])

  // XML highlight
  const xmlContent = useMemo(() => {
    if (fileType !== 'xml') return ''
    return highlightXml(fileContent)
  }, [fileType, fileContent])

  // CSV parse
  const csvData = useMemo(() => {
    if (fileType !== 'csv') return { headers: [], data: [] }
    return parseCSV(fileContent)
  }, [fileType, fileContent])

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
      <div className="h-full flex items-center justify-center">
        <Spin />
        <span className="ml-2 text-secondary">加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <WarningOutlined className="text-6xl text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-primary mb-2">文件加载失败</h3>
        <p className="text-disabled mb-4">{error}</p>
        <Button type="primary" icon={<ReloadOutlined />} onClick={loadFile}>
          重试
        </Button>
      </div>
    )
  }

  if (fileType === 'html' || fileType === 'htm') {
    return (
      <div className="h-full">
        <iframe
          srcDoc={fileContent}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    )
  }

  if (fileType === 'json') {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-sm font-mono bg-[#F8F9FA] p-4 rounded-lg overflow-auto">
          <code dangerouslySetInnerHTML={{ __html: jsonContent }} />
        </pre>
      </div>
    )
  }

  if (fileType === 'xml') {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-sm font-mono bg-[#F8F9FA] p-4 rounded-lg overflow-auto">
          <code dangerouslySetInnerHTML={{ __html: xmlContent }} />
        </pre>
      </div>
    )
  }

  if (fileType === 'csv') {
    const columns = csvData.headers.map((header, index) => ({
      title: header || `列 ${index + 1}`,
      dataIndex: `col_${index}`,
      key: `col_${index}`,
      ellipsis: true,
    }))

    return (
      <div className="h-full overflow-auto p-4">
        <Table
          columns={columns}
          dataSource={csvData.data}
          pagination={false}
          scroll={{ x: 'max-content', y: 500 }}
          size="small"
          bordered
        />
      </div>
    )
  }

  if (fileType === 'txt') {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-sm font-mono whitespace-pre-wrap break-words">{fileContent}</pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <WarningOutlined className="text-6xl text-orange-500 mb-4" />
      <h3 className="text-lg font-medium text-primary mb-2">不支持的文件类型</h3>
      <p className="text-disabled mb-4">当前文件类型 {fileType} 暂不支持预览</p>
      <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
        下载文件
      </Button>
    </div>
  )
}

// Helper functions
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
  if (currentLine) lines.push(currentLine)

  if (lines.length === 0) return { headers: [], data: [] }

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

function highlightJson(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'text-disabled'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'text-brand font-semibold' : 'text-[#059669]'
      } else if (/true|false/.test(match)) {
        cls = 'text-[#DC2626]'
      } else if (/null/.test(match)) {
        cls = 'text-disabled'
      } else if (/^-?\d/.test(match)) {
        cls = 'text-[#7C3AED]'
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

function highlightXml(xml: string): string {
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  // Format XML first
  let formatted = formatXML(xml)
  let escaped = escapeHtml(formatted)

  // Highlight CDATA
  escaped = escaped.replace(/&lt;!\[CDATA\[[\s\S]*?\]\]&gt;/g, (match: string) => {
    return `<span class="text-[#059669]">${match}</span>`
  })

  // Highlight comments
  escaped = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, (match: string) => {
    return `<span class="text-disabled italic">${match}</span>`
  })

  // Highlight tags
  escaped = escaped.replace(
    /&lt;([\w\-:]+)(\s+[^&]*?)?(\s*\/?&gt;)/g,
    (_match, tagName, attrs, closing) => {
      const openTag = `<span class="text-[#DC2626]">&lt;</span><span class="text-brand font-semibold">${tagName}</span>`
      if (attrs?.trim()) {
        const highlightedAttrs = attrs.replace(
          /([\w\-:]+)\s*=\s*(["'])(.*?)\2/g,
          (_, attrName, quote, attrValue) =>
            ` <span class="text-[#7C3AED]">${attrName}</span>=${quote}<span class="text-[#059669]">${attrValue}</span>${quote}`
        )
        return `${openTag}${highlightedAttrs}<span class="text-[#DC2626]">${closing}</span>`
      }
      return `${openTag}<span class="text-[#DC2626]">${closing}</span>`
    }
  )

  // Highlight closing tags
  escaped = escaped.replace(/&lt;(\/)([\w\-:]+)&gt;/g, (_, slash, tagName) => {
    return `<span class="text-[#DC2626]">&lt;${slash}</span><span class="text-brand font-semibold">${tagName}</span><span class="text-[#DC2626]">&gt;</span>`
  })

  // Highlight XML declaration and processing instructions
  escaped = escaped.replace(
    /&lt;\?([\w\-:]+)(\s+[^&]*?)?\?&gt;/g,
    (_match, name, attrs) => {
      const decl = `<span class="text-[#DC2626]">&lt;?</span><span class="text-brand font-semibold">${name}</span>`
      if (attrs?.trim()) {
        const highlightedAttrs = attrs.replace(
          /([\w\-:]+)\s*=\s*(["'])(.*?)\2/g,
          (_, attrName, quote, attrValue) =>
            ` <span class="text-[#7C3AED]">${attrName}</span>=${quote}<span class="text-[#059669]">${attrValue}</span>${quote}`
        )
        return `${decl}${highlightedAttrs}<span class="text-[#DC2626]">?&gt;</span>`
      }
      return `${decl}<span class="text-[#DC2626]">?&gt;</span>`
    }
  )

  return escaped
}

function formatXML(xml: string): string {
  let formatted = ''
  let indent = 0
  const tab = '  ' // 2 spaces indent
  xml = xml.trim()

  // Remove whitespace between tags
  xml = xml.replace(/>\s*</g, '><')

  for (let i = 0; i < xml.length; i++) {
    const char = xml[i]

    if (char === '<') {
      // Check if it's a closing tag
      if (xml[i + 1] === '/') {
        indent--
        formatted += `\n${tab.repeat(indent)}<`
      } else {
        if (i > 0 && xml[i - 1] !== '>') {
          formatted += `\n${tab.repeat(indent)}`
        }
        formatted += '<'
        // If it's a non-self-closing tag start, increase indent
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

export default NormalViewer