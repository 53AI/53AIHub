/**
 * Block 类型渲染器
 *
 * 从 InsightPageRenderer.tsx 提取，按 block.type 分发到对应 JSX 渲染。
 */
import React from 'react';
import type { DecisionPageBlock, MermaidFlowDiagram } from '@/api/modules/recording/types';
import {
  renderContent,
  renderInlineMarkdown,
  renderMarkdownText,
} from './richText';
import { normalizeItems, normalizeItem, pickField } from './fieldAlias';
import { MermaidFlowRenderer } from './mermaidFlowRenderer';
import { MermaidDiagram } from './mermaidDiagramRenderer';
import type { ParsedMermaid } from './mermaidDiagramParser';

/** tone → 中文标签映射，让 assumption_chain 步骤卡片左侧的小标题更可读 */
function toneLabel(tone: string | undefined): string {
  switch (tone) {
    case 'claim':       return '命题'
    case 'fragility':   return '脆弱'
    case 'alternative': return '替代解释'
    case 'note':        return '说明'
    default:            return '说明'
  }
}

// ============= 列表渲染器 =============

/** 为 ordered_list 和 unordered_list 提供统一渲染 */
function renderListBlock(block: DecisionPageBlock, index: number, noHeader?: boolean) {
  const key = block.id || `block-${index}`
  const data = block.data || {}
  const isOrdered = block.type === 'ordered_list'

  return (
    <div key={key} className="insight-card">
      {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
      {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
      <div className="insight-risk-grid">
        {(data.items || []).map((item: any, i: number) => (
          <div key={i} className="insight-item">
            <div className="item-title">
              {isOrdered && <span className="num">{item.number || i + 1}</span>}
              {item.title && <span>{item.title}</span>}
            </div>
            {item.content && (
              <div className="item-body insight-richtext">{renderContent(item.content)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============= Block 渲染器 =============

/** 判断 block 是否有实际内容需要渲染（避免渲染空卡片）*/
function hasBlockContent(block: DecisionPageBlock): boolean {
  const data = block.data || {}

  // section 类型：title 是外层卡片头部的元数据（renderBlockWithHeader 已渲染），
  // 内部 renderBlock 只渲染 content/subtitle/children——只看这三个，避免
  // "title 在但 content 已被 dropHrLines 丢弃为空"的 section 渲染空 insight-card。
  if (block.type === 'section') {
    if (data.subtitle && typeof data.subtitle === 'string' && data.subtitle.trim()) return true
    if (data.content && typeof data.content === 'string' && data.content.trim()) return true
    if (Array.isArray(data.children) && data.children.length > 0) return true
    return false
  }

  // 其他类型：检查所有可能包含内容的字符串字段（含 title/headline，因为 assumption_chain 的标题本身是命题）
  const stringFields = ['content', 'text', 'description', 'subtitle', 'intro', 'source', 'context', 'title', 'headline', 'judgment']
  for (const field of stringFields) {
    if (data[field] && typeof data[field] === 'string' && data[field].trim()) {
      return true
    }
  }

  // 检查所有可能包含内容的数组字段（含 steps，assumption_chain 的论证步骤）
  const arrayFields = ['items', 'actions', 'nodes', 'tags', 'children', 'steps']
  for (const field of arrayFields) {
    if (Array.isArray(data[field]) && data[field].length > 0) {
      return true
    }
  }

  // 结构化图（flow_diagram / mermaid_diagram）：从散文里拆出来的图 block 没有
  // title/intro 等字符串字段，内容全在 data.diagram 里，必须显式认它，否则整块被丢弃
  const diagram = data.diagram
  if (diagram && typeof diagram === 'object') {
    if (Array.isArray(diagram.nodes) && diagram.nodes.length > 0) return true
    if (typeof diagram.kind === 'string') return true
  }

  return false
}

/** 从 block 提取标题信息（标题文本 + 标签） */
function extractBlockHeader(block: DecisionPageBlock): { title: string | null; eyebrow: string | null } | null {
  const data = block.data || {}
  if (data.title || data.headline || data.judgment) {
    return { title: data.title || data.headline || data.judgment, eyebrow: data.eyebrow || data.label || null }
  }
  return null
}

/** 渲染单个 block */
function renderBlock(block: DecisionPageBlock, index: number, noHeader?: boolean) {
  if (!hasBlockContent(block)) return null

  const key = block.id || `block-${index}`
  const data = block.data || {}
  
  switch (block.type) {
    // ── page_header ──
    case 'page_header':
      return (
        <div key={key} className="insight-cover">
          {(data.label || data.eyebrow) && <span className="insight-cover-tag">{data.label || data.eyebrow}</span>}
          {data.title && <h2>{data.title}</h2>}
          {data.subtitle && <div className="insight-cover-subtitle">{renderContent(data.subtitle)}</div>}
        </div>
      )

    // ── decision_banner ──
    case 'decision_banner':
      return (
        <div key={key} className="insight-card">
          {!noHeader && data.eyebrow && <span className="eyebrow">{data.eyebrow}</span>}
          {!noHeader && data.headline && <h3>{renderInlineMarkdown(data.headline)}</h3>}
          {data.content && (
            <div className="insight-richtext">{renderContent(data.content)}</div>
          )}
        </div>
      )

    // ── hero_judgment ──
    case 'hero_judgment': {
      return (
        <div key={key} className="insight-card insight-hero">
          {!noHeader && data.label && <span className="eyebrow">{data.label}</span>}
          {!noHeader && data.headline && <h3>{renderInlineMarkdown(data.headline || data.judgment)}</h3>}
          {data.content && (
            <div className="insight-richtext">{renderContent(data.content || data.description)}</div>
          )}
          {Array.isArray(data.tags) && data.tags.length > 0 && (
            <div className="insight-tags">
              {data.tags.map((tag: string, i: number) => (
                <span key={i} className="insight-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )
    }

    // ── section ──
    case 'section':
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.subtitle && <div className="insight-section-intro">{renderContent(data.subtitle)}</div>}
          {data.content && typeof data.content === 'string' && (
            renderMarkdownText(data.content)
          )}
          {Array.isArray(data.children) && data.children.length > 0 && (
            <div className="space-y-3">
              {data.children.map((child: any, i: number) => {
                if (child.type && child.data) {
                  return renderBlock(child, i)
                }
                if (child.content) {
                  return (
                    <div key={i} className="insight-richtext">
                      {renderContent(child.content)}
                    </div>
                  )
                }
                if (typeof child === 'string') {
                  return <div key={i} className="insight-richtext">{renderMarkdownText(child)}</div>
                }
                return null
              })}
            </div>
          )}
        </div>
      )

    // ── paragraph ──
    case 'paragraph':
      return (
        <div key={key} className="insight-card">
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.content && (
            <div className="insight-richtext">{renderContent(data.content)}</div>
          )}
        </div>
      )

    // ── quote ──
    case 'quote':
      return (
        <div key={key} className="insight-card insight-quote">
          {data.text && (
            <div className="insight-richtext">{renderContent(data.text)}</div>
          )}
          {data.context && (
            <div className="insight-richtext" style={{ marginTop: 8 }}>{renderContent(data.context)}</div>
          )}
          {data.source && (
            <div className="item-meta" style={{ marginTop: 8 }}>—— {data.source}</div>
          )}
        </div>
      )

    // ── callout ──
    // variant: 'warning' | 'danger' | 'info'，缺省为中性
    case 'callout': {
      const variant = pickField(data, 'variant', 'tone')
      const variantClass = ['info', 'warning', 'danger'].includes(variant) ? ` ${variant}` : ''
      return (
        <div key={key} className={`insight-card insight-callout${variantClass}`}>
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.content && (
            <div className="insight-richtext">{renderContent(data.content)}</div>
          )}
        </div>
      )
    }

    // ── risk_list ──
    case 'risk_list':
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderMarkdownText(data.intro)}</div>}
          {(data.items || []).length > 0 && (
          <div className={`insight-risk-grid${data.tone ? ` tone-${data.tone}` : ''}`}>
            {(data.items || []).map((item: any, i: number) => {
              const severity = item.level || item.severity || 'medium'
              const hasTitle = item.title && item.title.trim()
              const itemContent = item.content || item.description || item.risk
              const hasContent = itemContent && itemContent.trim()
              if (!hasTitle && hasContent) {
                return (
                  <div key={i} className={`insight-item level-${severity}`}>
                    <div className="item-body insight-richtext">
                      {renderContent(itemContent)}
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className={`insight-item level-${severity}`}>
                  {hasTitle && (
                    <div className="item-title">
                      <span>{item.title}</span>
                    </div>
                  )}
                  {hasContent && (
                    <div className="item-body insight-richtext">
                      {renderContent(itemContent)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>)}
          {data.outro && <div className="insight-section-intro">{renderMarkdownText(data.outro)}</div>}
        </div>
      )

    // ── comparison ──
    case 'comparison': {
      const items = data.items || []
      const hasSubSections = data.hasSubSections
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          {items.length > 0 && (
            <div className="insight-compare-grid">
              {items.map((item: any, i: number) => {
                const compareClass = i === 0 ? 'bad' : i === 1 ? 'good' : 'neutral'
                const fallbackTitle = i === 0 ? '现状 / 代价' : i === 1 ? '调整方向' : '后续安排'
                const titleText = item.title || item.label || fallbackTitle
                // 子标题分组模式：渲染子标题 + 纯文本描述 + 列表
                if (hasSubSections) {
                  const subItems: string[] = item.items || []
                  return (
                    <div key={i} className={`insight-compare ${compareClass}`}>
                      <div className="compare-label">{titleText}</div>
                      {item.content && (
                        <div className="insight-richtext insight-compare-desc">{renderContent(item.content)}</div>
                      )}
                      {subItems.length > 0 && (
                        <ul className="insight-compare-list">
                          {subItems.map((raw: string, j: number) => (
                            <li key={j}>{renderInlineMarkdown(raw)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                }
                // 旧模式：单条对比项
                return (
                  <div key={i} className={`insight-compare ${compareClass}`}>
                    <div className="compare-label">{titleText}</div>
                    {item.title && <h4>{renderInlineMarkdown(item.title)}</h4>}
                    {item.content && (
                      <div className="insight-richtext">{renderContent(item.content)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    // ── flow_diagram ──
    // 优先级 1：后端 parse_mermaid_flow() 输出的 mermaid-flow.v1 数据(data.diagram)
    // 优先级 2：items[]（来自 decision_pipeline structured_items 或 markdownParser ### 子标题）
    // 通过 normalizeItems 把 {label,description} 和 {title,content} 两种形状统一
    case 'flow_diagram': {
      const diagram = data.diagram as MermaidFlowDiagram | undefined
      if (diagram && Array.isArray(diagram.nodes) && diagram.nodes.length > 0) {
        return (
          <div key={key} className="insight-card">
            {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
            {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
            {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
            <MermaidFlowRenderer diagram={diagram} />
          </div>
        )
      }

      const items = normalizeItems(data.items || data.nodes)
      if (items.length === 0) {
        // 都没有：降级为 section，保留 body 文本
        return (
          <div key={key} className="insight-card">
            {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
            {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
            {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
            {typeof data.body === 'string' && data.body && (
              <div className="insight-richtext">{renderMarkdownText(data.body)}</div>
            )}
          </div>
        )
      }
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          <div className="insight-flow">
            {items.map((node, i: number) => {
              const critical = /结果|后果|风险|警示|代价/.test(`${node.title} ${node.content}`) ? ' critical' : ''
              return (
                <React.Fragment key={i}>
                  {i > 0 && <div className="insight-flow-arrow">
                    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 42V6" stroke="#A75850" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><path d="M36 30L24 42L12 30" stroke="#A75850" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>}
                  <div className={`insight-flow-node${critical}`}>
                    <strong>{node.title || `推演 ${i + 1}`}</strong>
                    {node.content && (
                      <div className="insight-richtext">{renderMarkdownText(node.content)}</div>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )
    }

    // ── mermaid_diagram ──
    // 非流程图方言（sequence / pie / gantt / timeline）的结构化图，
    // 由 MermaidDiagram 按 kind 分发到对应渲染器
    case 'mermaid_diagram': {
      const diagram = data.diagram as ParsedMermaid | undefined
      if (!diagram || !diagram.kind) return null
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          <MermaidDiagram diagram={diagram} />
        </div>
      )
    }

    // ── assumption_chain ──
    // "脆弱假设"专用：把论证链按 tone 分层渲染——
    //   - claim：顶部"命题框"，把断言本身立起来（中性色，区别于风险的红色）
    //   - fragility：琥珀色"论据卡片"，区别于风险的亮红（用 --insight-accent-soft）
    //   - alternative：青绿色"替代解释"卡片
    //   - note：普通节点（沿用 insight-flow-node 视觉）
    //
    // 标题统一在外层 wrapper header 渲染（见 index.tsx renderBlockWithHeader），
    // 这里只渲染步骤链，不重复 data.title。
    case 'assumption_chain': {
      const steps = data.steps || []
      const claimSteps = steps.filter((s: any) => s.tone === 'claim')
      const evidenceSteps = steps.filter((s: any) => s.tone !== 'claim')
      return (
        <div key={key} className="insight-card">
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          {claimSteps.length > 0 && (
            <div className="insight-assumption-claims">
              {claimSteps.map((s: any, i: number) => (
                <div key={`claim-${i}`} className="insight-assumption-claim">
                  <div className="claim-label">命题</div>
                  <div className="claim-body insight-richtext">
                    <strong>{renderInlineMarkdown(s.label)}</strong>
                    {s.description && <div className="claim-desc">{renderContent(s.description)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {evidenceSteps.length > 0 && (
            <div className="insight-assumption-chain">
              {evidenceSteps.map((step: any, i: number) => (
                <div key={`step-${i}`} className={`insight-assumption-step tone-${step.tone || 'note'}`}>
                  <div className="step-head">
                    <span className="step-tone">{toneLabel(step.tone)}</span>
                    {step.label && <span className="step-label">{renderInlineMarkdown(step.label)}</span>}
                  </div>
                  {step.description && (
                    <div className="step-body insight-richtext">{renderContent(step.description)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.validationTag && (
            <div className="insight-assumption-validation">
              <span className="validation-tag">待验证</span>
              <span className="validation-text">{renderInlineMarkdown(data.validationTag)}</span>
            </div>
          )}
        </div>
      )
    }

    // ── timeline ──
    case 'timeline':
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          {(data.items || []).length > 0 && (
          <div className="insight-timeline">
            {(data.items || []).map((item: any, i: number) => (
              <div key={i} className="insight-timeline-item">
                <span className="timeline-dot" />
                <div className="timeline-date">{item.date || item.time_label || `节点 ${i + 1}`}</div>
                  <div className="timeline-title">{renderInlineMarkdown(item.event || item.title || '')}</div>
                {(item.content || item.description) && (
                  <div className="timeline-body insight-richtext">
                    {renderContent(item.content || item.description)}
                  </div>
                )}
              </div>
            ))}
          </div>)}
        </div>
      )

    // ── ordered_list / unordered_list ──
    case 'ordered_list':
    case 'unordered_list':
      return renderListBlock(block, index, noHeader)

    // ── action_list ──
    case 'action_list':
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderMarkdownText(data.intro)}</div>}
          {(data.items || data.actions || []).length > 0 && (
          <div className="insight-action-grid">
            {(data.items || data.actions || []).map((item: any, i: number) => {
              const actionContent = item.action || item.content
              const hasTitle = item.title && item.title.trim()
              const meta = [
                item.owner ? `负责人：${item.owner}` : '',
                item.deliverable ? `交付物：${item.deliverable}` : '',
                item.acceptance_criteria ? `验收：${item.acceptance_criteria}` : '',
                item.deadline ? `时限：${item.deadline}` : '',
                item.verification_method ? `验证：${item.verification_method}` : '',
                item.prohibition ? `禁止：${item.prohibition}` : '',
              ].filter(Boolean).join('；')
              return (
                <div key={item.id || i} className="insight-item">
                  <div className="item-title">
                    <div className="num">{item.number || i + 1}</div>
                    {hasTitle
                      ? renderInlineMarkdown(item.title)
                      : actionContent && (
                        <span className="insight-action-inline">{renderContent(actionContent)}</span>
                      )
                    }
                  </div>
                  {/* 有 title 时，action 显示在下方（保留原行为）；无 title 时 action 已合并到 item-title */}
                  {hasTitle && actionContent && (
                    <div className="item-body insight-richtext">{renderContent(actionContent)}</div>
                  )}
                  {meta && <div className="item-meta">{renderInlineMarkdown(meta)}</div>}
                </div>
              )
            })}
          </div>)}
        </div>
      )

    // ── rule_list ──
    case 'rule_list':
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          <div className="insight-risk-grid">
            {(data.items || []).map((item: any, i: number) => (
              <div key={i} className="insight-item">
                <div className="item-title">
                  {item.title && <span>{item.title}</span>}
                </div>
                {item.content && (
                  <div className="item-body insight-richtext">{renderContent(item.content)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )

    // ── red_line ──
    case 'red_line':
      return (
        <div key={key} className="insight-card" style={{ borderColor: '#fb7185' }}>
          {!noHeader && data.label && <span className="eyebrow" style={{ color: '#fb7185' }}>{data.label}</span>}
          {!noHeader && data.headline && <h3 style={{ color: '#dc2626' }}>{renderInlineMarkdown(data.headline)}</h3>}
          {data.content && <div className="insight-richtext">{renderContent(data.content)}</div>}
        </div>
      )

    // ── verification_list ──
    case 'verification_list':
      return (
        <div key={key} className="insight-card insight-card-verify">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderMarkdownText(data.intro)}</div>}
          {(data.items || []).length > 0 && (
          <div className="insight-verify-grid">
            {(data.items || []).map((item: any, i: number) => {
              const title = item.label || item.item
              const desc = item.content || item.why_needed
              const verificationMethod = item.verification_method
              const hasTitle = title && title.trim()
              const hasDesc = desc && desc.trim()
              const Checkbox = <span className="insight-checkbox" aria-hidden="true" />
              // 把 `**标题：** + 正文` 拼回单行内联展示，避免被拆成"标题行 + 正文行"两个视觉块
              const inlineText = hasTitle && hasDesc
                ? `**${title.trim()}**：${desc}`
                : (desc || title || '')
              return (
                <div key={item.id || i} className="insight-item insight-verify-item">
                  {inlineText && (
                    <div className="item-body insight-richtext">
                      {Checkbox}
                      <span className='item-body-main'>{renderContent(inlineText)}</span>
                    </div>
                  )}
                  {verificationMethod && (
                    <div className="item-meta">验证：{verificationMethod}</div>
                  )}
                </div>
              )
            })}
          </div>)}
        </div>
      )

    // ── key_points(核心要点)──
    case 'key_points': {
      const items = normalizeItems(data.items || data.points)
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          {items.length > 0 && (
            <ul className="insight-key-points">
              {items.map((item, i: number) => (
                <li key={i} className="key-point-item">
                  <span className="key-point-bullet">{i + 1}</span>
                  <div>
                    {item.title && <div className="key-point-title">{renderInlineMarkdown(item.title)}</div>}
                    {item.content && <div className="key-point-content insight-richtext">{renderMarkdownText(item.content)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }

    // ── long_analysis(长文分析)──
    // data.sections?: Array<{label, content}> —— 结构化分段
    // data.intro?: string —— 开头导语
    // data.content?: string —— 整段纯文本（无分段时）
    case 'long_analysis': {
      const sections: Array<{ title: string; content: string }> = Array.isArray(data.sections)
        ? data.sections.map((s: any) => normalizeItem(s)).filter(s => s.title || s.content)
        : []
      return (
        <div key={key} className="insight-card insight-long-analysis">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="la-intro insight-richtext">{renderMarkdownText(data.intro)}</div>}
          {sections.length > 0 ? (
            sections.map((s, i: number) => (
              <div key={i} className="la-section">
                {s.title && <div className="la-section-label">{renderInlineMarkdown(s.title)}</div>}
                {s.content && <div className="la-section-body insight-richtext">{renderMarkdownText(s.content)}</div>}
              </div>
            ))
          ) : (
            typeof data.content === 'string' && data.content && (
              <div className="la-section-body insight-richtext">{renderMarkdownText(data.content)}</div>
            )
          )}
        </div>
      )
    }

    // ── insight_stack(多条洞察堆叠)──
    // data.items?: Array<{title, content}> —— 每条独立成卡
    case 'insight_stack': {
      const items = normalizeItems(data.items || data.insights)
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.intro && <div className="insight-section-intro">{renderContent(data.intro)}</div>}
          {items.length > 0 && (
            <div className="insight-insight-stack">
              {items.map((item, i: number) => (
                <div key={i} className="stack-item">
                  <div className="stack-item-head">
                    <span className="stack-item-index">{i + 1}</span>
                    {item.title && <span className="stack-item-title">{renderInlineMarkdown(item.title)}</span>}
                  </div>
                  {item.content && <div className="stack-item-body insight-richtext">{renderMarkdownText(item.content)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    // ── breakthrough(破局点)──
    // data.headline?: string —— 破局主张
    // data.content?: string —— 破局理由/路径
    // data.cta?: string —— 可选行动提示
    case 'breakthrough': {
      const headline = pickField(data, 'headline', 'title', 'judgment')
      const content = pickField(data, 'content', 'description', 'analysis')
      const cta = pickField(data, 'cta', 'action', 'next_step')
      return (
        <div key={key} className="insight-card insight-breakthrough">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {headline && <h3>{renderInlineMarkdown(headline)}</h3>}
          {content && <div className="breakthrough-content insight-richtext">{renderMarkdownText(content)}</div>}
          {cta && <div className="breakthrough-foot">下一步：{renderInlineMarkdown(cta)}</div>}
        </div>
      )
    }

    case 'closing':
      return (
        <div key={key} className="insight-card insight-closing">
          {data.content && (
            <div>{renderContent(data.content)}</div>
          )}
        </div>
      )

    // ── 未知类型降级展示 ──
    default:
      return (
        <div key={key} className="insight-card">
          {!noHeader && (data.eyebrow || data.label) && <span className="eyebrow">{data.eyebrow || data.label}</span>}
          {!noHeader && data.title && <h3>{renderInlineMarkdown(data.title)}</h3>}
          {data.content && (
            <div className="insight-richtext">{renderContent(data.content)}</div>
          )}
        </div>
      )
  }
}

export {
  renderListBlock,
  renderBlock,
  extractBlockHeader,
}