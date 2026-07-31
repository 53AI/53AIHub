/**
 * mermaid-flow.v1 流程图 SVG 渲染器
 *
 * 输入：parse_mermaid_flow() 输出的 {syntax, direction, nodes, edges} 结构。
 * 算法：rank 分层 → 同层均匀分布 → 正交折线。
 * 完全本地实现，无第三方依赖；与 React 其它卡片共享 --insight-accent 主题变量。
 */
import React from 'react'
import type {
  MermaidFlowDiagram,
  MermaidFlowNode,
  MermaidFlowEdge,
} from '@/api/modules/recording/types'

// ============= 布局常量 =============

const NODE_W = 200
const NODE_H = 90
const COL_GAP = 70   // 同层节点水平间距（TB 模式）
const ROW_GAP = 60   // 同列节点垂直间距（LR 模式）
const RANK_GAP_TB = 70 // TB 模式不同 rank 之间的纵向间距
const RANK_GAP_LR = 70 // LR 模式不同 rank 之间的横向间距
const CANVAS_PAD = 24

const TITLE_CHARS = 13
const TITLE_LINES = 2
const CONTENT_CHARS = 19
const CONTENT_LINES = 3
const LINE_H_TITLE = 17
const LINE_H_CONTENT = 14
const NODE_PAD_X = 12
const NODE_PAD_Y = 10

// ============= 文本截断/换行 =============

/** 把文本按 maxChars 切分到 maxLines 行；超出用 … 省略 */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const value = (text || '').trim()
  if (!value) return []
  const lines: string[] = []
  let remaining = value
  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining)
      remaining = ''
      break
    }
    let breakAt = remaining.lastIndexOf(' ', maxChars)
    if (breakAt <= 0 || breakAt >= remaining.length - 1) breakAt = maxChars
    lines.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }
  if (remaining.length > 0 && lines.length >= maxLines) {
    const last = lines[maxLines - 1]
    if (last.length >= maxChars - 1) {
      lines[maxLines - 1] = last.slice(0, maxChars - 1) + '…'
    } else {
      lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…'
    }
  }
  return lines
}

// ============= 配色（按 tone） =============

interface TonePalette {
  fill: string
  stroke: string
  text: string
  textMuted: string
  dashed: boolean
}

function getToneColors(tone: string): TonePalette {
  switch (tone) {
    case 'positive':
      return { fill: '#f0fdf4', stroke: '#22c55e', text: '#14532d', textMuted: '#166534', dashed: false }
    case 'info':
      return { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e3a8a', textMuted: '#1e40af', dashed: false }
    case 'warning':
      return { fill: '#fffbeb', stroke: '#f59e0b', text: '#78350f', textMuted: '#92400e', dashed: false }
    case 'danger':
      return { fill: '#fef2f2', stroke: '#ef4444', text: '#7f1d1d', textMuted: '#991b1b', dashed: false }
    case 'critical':
      return { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d', textMuted: '#991b1b', dashed: false }
    case 'pending':
      return { fill: '#f9fafb', stroke: '#9ca3af', text: '#374151', textMuted: '#4b5563', dashed: true }
    default:
      return { fill: '#f5f6f7', stroke: '#cbd5e1', text: '#1d2b3e', textMuted: '#4f5052', dashed: false }
  }
}

// ============= 布局算法 =============

interface Position {
  x: number
  y: number
  w: number
  h: number
}

interface Layout {
  width: number
  height: number
  positions: Map<string, Position>
}

function groupByRank(nodes: MermaidFlowNode[]): Map<number, MermaidFlowNode[]> {
  const groups = new Map<number, MermaidFlowNode[]>()
  for (const node of nodes) {
    const list = groups.get(node.rank) || []
    list.push(node)
    groups.set(node.rank, list)
  }
  return groups
}

function layoutDiagram(diagram: MermaidFlowDiagram): Layout {
  const positions = new Map<string, Position>()
  const groups = groupByRank(diagram.nodes)
  const ranks = Array.from(groups.keys()).sort((a, b) => a - b)
  const isTB = diagram.direction !== 'LR'
  const maxPerRank = Math.max(1, ...Array.from(groups.values(), list => list.length))

  if (isTB) {
    const rowW = maxPerRank * NODE_W + (maxPerRank - 1) * COL_GAP
    const totalW = Math.max(360, rowW) + CANVAS_PAD * 2
    const totalH = ranks.length * NODE_H + (ranks.length - 1) * RANK_GAP_TB + CANVAS_PAD * 2

    let y = CANVAS_PAD
    for (const rank of ranks) {
      const list = groups.get(rank) || []
      const listW = list.length * NODE_W + (list.length - 1) * COL_GAP
      const startX = (totalW - listW) / 2
      for (let i = 0; i < list.length; i++) {
        const node = list[i]
        positions.set(node.id, { x: startX + i * (NODE_W + COL_GAP), y, w: NODE_W, h: NODE_H })
      }
      y += NODE_H + RANK_GAP_TB
    }
    return { width: totalW, height: totalH, positions }
  }

  // LR：rank 沿 X 轴展开，同 rank 内沿 Y 轴展开
  const colH = maxPerRank * NODE_H + (maxPerRank - 1) * ROW_GAP
  const totalH = Math.max(220, colH) + CANVAS_PAD * 2
  const totalW = ranks.length * NODE_W + (ranks.length - 1) * RANK_GAP_LR + CANVAS_PAD * 2

  let x = CANVAS_PAD
  for (const rank of ranks) {
    const list = groups.get(rank) || []
    const listH = list.length * NODE_H + (list.length - 1) * ROW_GAP
    const startY = (totalH - listH) / 2
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      positions.set(node.id, { x, y: startY + i * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H })
    }
    x += NODE_W + RANK_GAP_LR
  }
  return { width: totalW, height: totalH, positions }
}

// ============= 边的正交路径 =============

/** 为 TB 走向生成三段折线（向下 → 横移 → 向下） */
function tbEdgePath(from: Position, to: Position): string {
  const sx = from.x + from.w / 2
  const sy = from.y + from.h
  const tx = to.x + to.w / 2
  const ty = to.y
  const midY = (sy + ty) / 2
  return `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`
}

/** 为 LR 走向生成三段折线（向右 → 纵移 → 向右） */
function lrEdgePath(from: Position, to: Position): string {
  const sx = from.x + from.w
  const sy = from.y + from.h / 2
  const tx = to.x
  const ty = to.y + to.h / 2
  const midX = (sx + tx) / 2
  return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`
}

function edgePath(direction: 'TB' | 'LR', from: Position, to: Position): string {
  return direction === 'LR' ? lrEdgePath(from, to) : tbEdgePath(from, to)
}

// ============= 组件 =============

interface MermaidFlowRendererProps {
  diagram: MermaidFlowDiagram
  /** 外部容器 className（用于嵌套在 .insight-card 内） */
  className?: string
}

export function MermaidFlowRenderer({ diagram, className }: MermaidFlowRendererProps) {
  if (!diagram || !Array.isArray(diagram.nodes) || diagram.nodes.length === 0) return null
  const layout = layoutDiagram(diagram)
  const isTB = diagram.direction !== 'LR'

  // 边标签位置：取路径中点（TB 取横段中点；LR 取纵段中点）
  const labelPositions = (edge: MermaidFlowEdge): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } | null => {
    const fromPos = layout.positions.get(edge.from)
    const toPos = layout.positions.get(edge.to)
    if (!fromPos || !toPos) return null
    if (isTB) {
      const midY = (fromPos.y + fromPos.h + toPos.y) / 2
      const x = (fromPos.x + fromPos.w / 2 + toPos.x + toPos.w / 2) / 2
      return { x, y: midY - 6, anchor: 'middle' }
    }
    const midX = (fromPos.x + fromPos.w + toPos.x) / 2
    const y = (fromPos.y + fromPos.h / 2 + toPos.y + toPos.h / 2) / 2
    return { x: midX, y: y - 6, anchor: 'middle' }
  }

  return (
    <div className={`insight-mermaid-flow ${className || ''}`}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="因果/推演流程图"
      >
        <defs>
          {/* 箭头 marker：与 accent 颜色绑定；中性灰色，不抢节点视觉 */}
          <marker
            id="insight-mermaid-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* 边 */}
        {diagram.edges.map((edge, idx) => {
          const fromPos = layout.positions.get(edge.from)
          const toPos = layout.positions.get(edge.to)
          if (!fromPos || !toPos) return null
          const d = edgePath(diagram.direction, fromPos, toPos)
          return (
            <g key={`e-${idx}`}>
              <path
                d={d}
                className="insight-mermaid-edge"
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.5}
                markerEnd="url(#insight-mermaid-arrow)"
              />
              {edge.label && labelPositions(edge) && (() => {
                const lp = labelPositions(edge)!
                return (
                  <text
                    x={lp.x}
                    y={lp.y}
                    textAnchor={lp.anchor}
                    className="insight-mermaid-edge-label"
                    fill="#64748b"
                    fontSize={11}
                  >
                    {edge.label}
                  </text>
                )
              })()}
            </g>
          )
        })}

        {/* 节点 */}
        {diagram.nodes.map(node => {
          const pos = layout.positions.get(node.id)
          if (!pos) return null
          const colors = getToneColors(node.tone)
          const titleLines = wrapText(node.title || node.id, TITLE_CHARS, TITLE_LINES)
          const contentLines = wrapText(node.content, CONTENT_CHARS, CONTENT_LINES)

          const titleEls = titleLines.map((line, i) => (
            <text
              key={`t-${i}`}
              x={pos.x + NODE_PAD_X}
              y={pos.y + NODE_PAD_Y + (i + 1) * LINE_H_TITLE}
              className="insight-mermaid-node-title"
              fontSize={14}
              fontWeight={700}
              fill={colors.text}
            >
              {line}
            </text>
          ))
          // 内容第一行的 y = title 区底部 + 4px 间隙 + 1 行 line-height
          const contentStartY = pos.y + NODE_PAD_Y + titleLines.length * LINE_H_TITLE + 4 + LINE_H_CONTENT
          const contentEls = contentLines.length > 0
            ? contentLines.map((line, i) => (
                <text
                  key={`c-${i}`}
                  x={pos.x + NODE_PAD_X}
                  y={contentStartY + i * LINE_H_CONTENT}
                  className="insight-mermaid-node-content"
                  fontSize={11}
                  fill={colors.textMuted}
                >
                  {line}
                </text>
              ))
            : null

          return (
            <g key={node.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.w}
                height={pos.h}
                rx={8}
                ry={8}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={1.5}
                strokeDasharray={colors.dashed ? '5 4' : undefined}
              />
              {titleEls}
              {contentEls}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default MermaidFlowRenderer