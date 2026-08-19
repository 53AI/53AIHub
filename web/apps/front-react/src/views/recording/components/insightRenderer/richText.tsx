/**
 * 富文本/Markdown 渲染函数
 */

import React from 'react';
import { MermaidDiagram } from './mermaidDiagramRenderer';
import { parseMermaidDiagram } from './mermaidDiagramParser';

// ============= Rich Text 渲染 =============

/** 为文本节点应用 marks（从内到外包装） */
function renderRichTextWithMarks(text: string, marks?: string[]): React.ReactNode {
  let node: React.ReactNode = text
  // 先应用内联样式（code、bold），再应用语义颜色（从弱到强）
  if (marks?.includes('code')) node = <code className="bg-[#F3F4F6] text-[#EF4444] px-1 rounded text-xs">{node}</code>
  if (marks?.includes('bold')) node = <strong>{node}</strong>
  if (marks?.includes('highlight')) node = <span className="bg-[#FEF9C3] px-0.5 rounded">{node}</span>
  if (marks?.includes('info')) node = <span className="text-[#2563EB]">{node}</span>
  if (marks?.includes('positive')) node = <span className="text-[#16A34A]">{node}</span>
  if (marks?.includes('warning')) node = <span className="text-[#D97706]">{node}</span>
  if (marks?.includes('danger')) node = <span className="text-[#EF4444]">{node}</span>
  return node
}

/** 递归渲染富文本 AST */
function renderRichTextNode(node: any): React.ReactNode {
  if (!node) return null

  // 纯文本节点（含 marks）
  if (node.type === 'text' && typeof node.text === 'string') {
    return renderRichTextWithMarks(node.text, node.marks)
  }

  // 容器节点：递归渲染其 children
  const children = node.children?.map((child: any, i: number) => (
    <React.Fragment key={i}>{renderRichTextNode(child)}</React.Fragment>
  ))

  switch (node.type) {
    case 'paragraph':
      return <p className="text-sm leading-relaxed [&+&]:mt-2">{children}</p>
    case 'ordered_list':
      return <ol className="list-decimal pl-5 space-y-1">{children}</ol>
    case 'unordered_list':
      return <ul className="list-disc pl-5 space-y-1">{children}</ul>
    case 'list_item':
      return <li>{children}</li>
    case 'inline_code':
      return <code className="bg-[#F3F4F6] text-[#EF4444] px-1 rounded text-xs">{node.text}</code>
    case 'quote':
      return <blockquote className="border-l-2 border-[#D1D5DB] pl-3 italic text-secondary">{children}</blockquote>
    default:
      return typeof node.text === 'string' ? node.text : children || null
  }
}

/** 将 content 字段统一渲染为 React 节点（支持 string、rich_text AST、node[] 数组）
 *  - string 内容用 renderMarkdownText 解析
 *  - rich_text AST 用 renderRichTextNode 递归渲染
 */
function renderContent(content: any): React.ReactNode {
  if (!content) return null
  if (typeof content === 'string') return renderMarkdownText(content)
  // rich_text 标准格式：{ type: "rich_text", children: [...] }
  if (content.type === 'rich_text' && Array.isArray(content.children)) {
    return content.children.map((child: any, i: number) => (
      <React.Fragment key={i}>{renderRichTextNode(child)}</React.Fragment>
    ))
  }
  // 数组格式：直接渲染节点列表（如 hero_judgment 的 content 为 [{ type: "paragraph", children: [...] }]）
  if (Array.isArray(content)) {
    return content.map((node: any, i: number) => (
      <React.Fragment key={i}>{renderRichTextNode(node)}</React.Fragment>
    ))
  }
  // 未知结构降级
  return JSON.stringify(content)
}

// ============= Markdown 文本渲染 =============

/** 表格分隔行匹配：:--- / ---: / :---: / ---，至少 2 个单元格 */
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/
/** 简单判定是否为表格行（含 |） */
const isTableRow = (line: string) => line.includes('|')
/** 拆分行单元格：去掉首尾可选 | 后按 | 拆分并 trim */
const splitTableRow = (line: string): string[] => {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map(c => c.trim())
}
type CellAlign = 'left' | 'center' | 'right' | null
const parseCellAlign = (cell: string): CellAlign => {
  const t = cell.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/** 将 Markdown 文本解析为 React 节点（段落、列表、引用、标题、分割线、表格） */
function renderMarkdownText(value: string): React.ReactNode {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n')
  const output: React.ReactNode[] = []
  let paragraph: string[] = []
  let listType: '' | 'ul' | 'ol' = ''
  let listItems: string[] = []
  const keyBase = 'md-'

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(
        <p key={`${keyBase}p-${output.length}`}>
          {paragraph.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              {renderInlineMarkdown(item)}
            </React.Fragment>
          ))}
        </p>
      )
      paragraph = []
    }
  }

  const flushList = () => {
    if (listItems.length) {
      const Tag = listType === 'ol' ? 'ol' : 'ul'
      output.push(
        <Tag key={`${keyBase}${listType}-${output.length}`}>
          {listItems.map((item, i) => (
            <li key={i}>{renderInlineMarkdown(item)}</li>
          ))}
        </Tag>
      )
      listItems = []
      listType = ''
    }
  }

  const flushTable = (header: string[], aligns: CellAlign[], rows: string[][]) => {
    if (!header.length) return
    const cols = header.length
    output.push(
      <div key={`${keyBase}table-${output.length}`} className="insight-table-wrap">
        <table className="insight-table">
          <thead>
            <tr>
              {header.map((cell, j) => (
                <th key={j} style={aligns[j] ? { textAlign: aligns[j] } : undefined}>
                  {renderInlineMarkdown(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} style={aligns[c] ? { textAlign: aligns[c] } : undefined}>
                    {renderInlineMarkdown(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const flushCodeBlock = (lang: string, code: string) => {
    // ```mermaid``` 围栏：原地解析为图，并按其在 markdown 流中的位置直接渲染。
    // 图作为源段落（[因果链]/[脆弱假设]/[风险]/...）正文的一部分，与前后散文一起
    // 在同一张卡片里展示，避免"图被拆成独立卡片漂在源段落外面"的视觉割裂。
    // 解析失败（方言未支持 / 语法错）→ 兜底为 <pre><code>，让用户至少能看到源码。
    if (lang === 'mermaid') {
      const body = code.replace(/^\n+|\n+$/g, '')
      const parsed = parseMermaidDiagram(body)
      if (parsed) {
        output.push(
          <MermaidDiagram diagram={parsed} />
        )
        return
      }
    }
    // 保留原始换行（pre 元素天然保留空白），仅去掉首尾空行
    const body = code.replace(/^\n+|\n+$/g, '')
    const langClass = lang ? `language-${lang}` : ''
    output.push(
      <pre key={`${keyBase}code-${output.length}`} className="insight-code-block">
        <code className={langClass}>{body}</code>
      </pre>
    )
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    // 围栏代码块：```lang 起，``` 结束。
    // 注意：在 [因果链] 路径下，```mermaid 已被 markdownParser 提取走 flow_diagram.data.diagram，
    // 不会落回到这里；这里只承担"其它围栏代码块"的兜底渲染（包括 mermaid 解析失败时）。
    const fenceOpen = trimmed.match(/^```\s*([A-Za-z0-9_+\-#]*)\s*$/)
    if (fenceOpen) {
      flushParagraph()
      flushList()
      const lang = fenceOpen[1] || ''
      const codeLines: string[] = []
      let j = i + 1
      while (j < lines.length && !/^```\s*$/.test(lines[j].trim())) {
        codeLines.push(lines[j])
        j++
      }
      flushCodeBlock(lang, codeLines.join('\n'))
      // 若到了文件末尾都没有闭合，把光标推到末尾（避免死循环）
      i = j < lines.length ? j : lines.length - 1
      continue
    }

    // 表格检测：当前行含 | 且下一行是分隔行
    if (isTableRow(trimmed) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1].trim())) {
      flushParagraph()
      flushList()
      const header = splitTableRow(trimmed)
      const aligns = splitTableRow(lines[i + 1]).map(parseCellAlign)
      let cursor = i + 2
      const rows: string[][] = []
      while (cursor < lines.length && isTableRow(lines[cursor])) {
        rows.push(splitTableRow(lines[cursor]))
        cursor++
      }
      // cursor 现在指向表格后的下一行（for 的 i++ 会再 +1，将其指向下一行）
      i = cursor - 1
      flushTable(header, aligns, rows)
      continue
    }

    // ## [marker] headings → h3
    const h2Match = trimmed.match(/^##\s+\[([^\]]+)\]\s*(.*)/)
    if (h2Match) {
      flushParagraph()
      flushList()
      output.push(
        <div key={`${keyBase}h2-${output.length}`} className="flex items-center gap-2">
          <span className="eyebrow">{h2Match[1]}</span>
          <h3>{renderInlineMarkdown(h2Match[2])}</h3>
        </div>
      )
      continue
    }

    // ## headings (无 marker) → h3
    const h2PlainMatch = trimmed.match(/^##\s+(.+)$/)
    if (h2PlainMatch) {
      flushParagraph()
      flushList()
      output.push(<h3 key={`${keyBase}h2-${output.length}`}>{renderInlineMarkdown(h2PlainMatch[1])}</h3>)
      continue
    }

    // ### - ###### [marker] headings → h4
    const headingMarkerMatch = trimmed.match(/^(#{3,6})\s+\[([^\]]+)\]\s*(.*)/)
    if (headingMarkerMatch) {
      flushParagraph()
      flushList()
      output.push(
        <div key={`${keyBase}h-${output.length}`} className="flex items-center gap-2">
          <span className="eyebrow">{headingMarkerMatch[2]}</span>
          <h4>{renderInlineMarkdown(headingMarkerMatch[3])}</h4>
        </div>
      )
      continue
    }

    // ### - ###### headings (无 marker) → h4
    const headingMatch = trimmed.match(/^#{3,6}\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      output.push(<h4 key={`${keyBase}h-${output.length}`}>{renderInlineMarkdown(headingMatch[1])}</h4>)
      continue
    }

    // Unordered list
    const unorderedMatch = trimmed.match(/^(?:[-*•])\s+(.+)$/)
    // Ordered list
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/)

    if (unorderedMatch || orderedMatch) {
      flushParagraph()
      const nextType: 'ul' | 'ol' = unorderedMatch ? 'ul' : 'ol'
      if (listType && listType !== nextType) flushList()
      listType = nextType
      listItems.push((unorderedMatch || orderedMatch)![1])
      continue
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      flushParagraph()
      flushList()
      output.push(
        <blockquote key={`${keyBase}q-${output.length}`} className="insight-blockquote">
          {renderInlineMarkdown(trimmed.replace(/^>\s?/, ''))}
        </blockquote>
      )
      continue
    }

    // Horizontal rule
    if (/^(---+|___+)$/.test(trimmed)) {
      flushParagraph()
      flushList()
      output.push(<hr key={`${keyBase}hr-${output.length}`} />)
      continue
    }

    // Regular text → paragraph
    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return <>{output}</>
}

// ============= Markdown 内联标记解析 =============

/** 将 Markdown 内联标记解析为 React 节点 */
function renderInlineMarkdown(value: string): React.ReactNode {
  // Parse inline markdown patterns: `code`, **bold**, __bold__, *italic*
  const parts: Array<{ text: string; type: 'text' | 'code' | 'strong' | 'em' }> = []
  let remaining = value

  // Pattern priority: code > strong > em (same as test-insight.html)
  while (remaining.length > 0) {
    // Find all candidate matches at their positions in the remaining string
    const codeMatch = remaining.match(/`([^`]+)`/)
    const strongMatch = remaining.match(/\*\*([^*\n]+)\*\*/)
    const strongUnderMatch = remaining.match(/__([^_\n]+)__/)
    const emMatch = remaining.match(/(^|[^*])\*([^*\n]+)\*(?!\*)/)

    // Build candidates with position info
    interface Candidate {
      index: number
      length: number
      group: string
      type: 'code' | 'strong' | 'em'
      prefixLen: number  // characters before the actual styled content (e.g. ^|[^*] prefix for em)
    }
    const candidates: Candidate[] = []

    if (codeMatch) candidates.push({ index: codeMatch.index!, length: codeMatch[0].length, group: codeMatch[1], type: 'code', prefixLen: 0 })
    if (strongMatch) candidates.push({ index: strongMatch.index!, length: strongMatch[0].length, group: strongMatch[1], type: 'strong', prefixLen: 0 })
    if (strongUnderMatch) candidates.push({ index: strongUnderMatch.index!, length: strongUnderMatch[0].length, group: strongUnderMatch[1], type: 'strong', prefixLen: 0 })
    if (emMatch) {
      // emMatch[1] is the prefix (^ or [^*]), emMatch[2] is the italicized content
      const prefix = emMatch[1] || ''
      candidates.push({
        index: emMatch.index!,
        length: emMatch[0].length,
        group: emMatch[2],
        type: 'em',
        prefixLen: prefix.length,
      })
    }

    if (candidates.length === 0) {
      parts.push({ text: remaining, type: 'text' })
      break
    }

    // Pick the earliest match
    const earliest = candidates.reduce((a, b) => a.index <= b.index ? a : b)

    // Text before the match (including any prefix characters that belong to plain text)
    const textBeforeEnd = earliest.index + earliest.prefixLen
    if (textBeforeEnd > 0) {
      parts.push({ text: remaining.slice(0, textBeforeEnd), type: 'text' })
    }

    parts.push({ text: earliest.group, type: earliest.type })

    remaining = remaining.slice(earliest.index + earliest.length)
  }

  return parts.map((part, i) => {
    switch (part.type) {
      case 'code':
        return <code key={`c-${i}`} className="insight-inline-code">{part.text}</code>
      case 'strong':
        return <strong key={`s-${i}`}>{part.text}</strong>
      case 'em':
        return <em key={`e-${i}`}>{part.text}</em>
      default:
        return part.text
    }
  })
}

export {
  renderRichTextWithMarks,
  renderRichTextNode,
  renderContent,
  renderMarkdownText,
  renderInlineMarkdown,
}