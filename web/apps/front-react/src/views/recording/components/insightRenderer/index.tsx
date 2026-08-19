/**
 * 决策页面编排结果渲染组件
 *
 * 按 blocks[].type 映射到对应前端组件渲染。
 */
import type React from 'react';
import type { DecisionPageBlock } from '@/api/modules/recording/types';
import './InsightPageRenderer.v2.css';
import { renderContent } from './richText';
import { parseInsightMarkdown } from './markdownParser';
import { renderBlock, extractBlockHeader } from './blockRenderers';
import { renderInlineMarkdown } from './richText';

/** 把 hex 颜色 + 透明度转换成 rgba 字符串（用于生成 accent-soft） */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim()
  if (h.length !== 6 || Number.isNaN(parseInt(h, 16))) return `rgba(0,0,0,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface InsightPageRendererProps {
  pageJson: Record<string, any>
  /** 自定义主题色（hex），会覆盖预设主题和 pageJson.color */
  accentColor?: string
}

// ============= Block 包装 =============

function renderBlockWithHeader(block: DecisionPageBlock, index: number) {
  if ( block.type === 'page_header') {
    return renderBlock(block, index)
  }

  const header = extractBlockHeader(block)

  if (!header) {
    // 无标题的 block（paragraph, quote, closing 等）直接渲染
    return renderBlock(block, index)
  }

  // B 范围：内部 block 实际无内容（如 title 存在但 content 已被 dropHrLines 丢弃为空），
  // 整个 wrapper 不渲染，避免"有 title 无 content"的空卡片。
  const inner = renderBlock(block, index, true)
  if (inner == null) return null

  return (
    <div key={block.id || `block-${index}`} className="insight-block-wrapper">
      <div className="insight-block-header">
        <span className="insight-block-header-bar" />
        <div>
          {header.title && <h3>{renderInlineMarkdown(header.title)}</h3>}
        </div>
      </div>
      {inner}
    </div>
  )
}

// ============= 主组件 =============

export function InsightPageRenderer({ pageJson, accentColor }: InsightPageRendererProps) {
  // 预设主题（兼容旧格式 JSON Block 的 theme 字段）
  const theme = ['blue', 'purple', 'orange', 'red', 'dark'].includes(pageJson?.theme) ? pageJson.theme : ''

  // 自定义主题色优先级：prop > pageJson.color > 预设主题
  const resolvedAccent = accentColor || pageJson?.color || ''
  // 覆盖 --insight-accent 和 --insight-accent-soft 两个 CSS 变量
  const accentStyle = resolvedAccent
    ? ({
        '--insight-accent': resolvedAccent,
        '--insight-accent-soft': hexToRgba(resolvedAccent, 0.14),
      } as React.CSSProperties)
    : undefined

  // 新格式：Markdown 字符串，解析语义标记后按卡片样式渲染
  if (pageJson._markdown) {
    const { pageTitle, pageSubtitle, pageTag, blocks } = parseInsightMarkdown(pageJson._markdown)

    return (
      <div
        className={`insight-schema flex-col self-stretch space-y-7 ${theme ? `theme-${theme}` : ''}`}
        style={accentStyle}
      >
        {/* 页面标题 + 摘要 */}
        {(pageTitle || pageSubtitle) && (
          <div className="insight-cover">
            {pageTag && <span className="insight-cover-tag">{pageTag}</span>}
            {pageTitle && <h2>{pageTitle}</h2>}
            {pageSubtitle && <div className="insight-cover-subtitle">{renderContent(pageSubtitle)}</div>}
          </div>
        )}

        {/* 语义标记段落 */}
        {blocks.map((block, index) => renderBlockWithHeader(block as DecisionPageBlock, index))}
      </div>
    )
  }

  // 旧格式：JSON Block 结构
  const { blocks = [], closing } = pageJson

  // 检查 blocks 中是否已包含 page_header 和 closing
  const hasPageHeader = blocks.some((b: DecisionPageBlock) => b.type === 'page_header')
  const hasClosingBlock = blocks.some((b: DecisionPageBlock) => b.type === 'closing')

  return (
    <div
      className={`insight-schema flex-col self-stretch space-y-7 ${theme ? `theme-${theme}` : ''}`}
      style={accentStyle}
    >
      {/* 如果 blocks 中没有 page_header，则用顶层 title/subtitle 作为标题 */}
      {!hasPageHeader && pageJson.title && (
        <div className="insight-cover">
          {pageJson.label && <span className="insight-cover-tag">{pageJson.label}</span>}
          <h2>{pageJson.title}</h2>
          {pageJson.subtitle && (
            <div className="insight-cover-subtitle">{renderContent(pageJson.subtitle)}</div>
          )}
        </div>
      )}

      {/* Blocks */}
      {blocks.map((block: DecisionPageBlock, index: number) => renderBlockWithHeader(block, index))}

      {/* 如果 blocks 中没有 closing block，则用顶层 closing 渲染 */}
      {!hasClosingBlock && closing?.content && (
        <div className="insight-closing">{renderContent(closing.content)}</div>
      )}
    </div>
  )
}

export default InsightPageRenderer