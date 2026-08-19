/**
 * mermaid-flow.v1 流程图渲染器
 *
 * 仿 meeting-recorder 的实现：
 * - 节点用 HTML <article> 卡片（CSS 自动换行，box 高度自然撑开）
 * - 边用 SVG overlay（位置基于节点实测高度计算）
 * - useLayoutEffect 测量 offsetHeight，触发动态重排
 * - 不依赖第三方 mermaid 运行时；与 React 其它卡片共享 --insight-accent 主题变量
 *
 * 算法：rank 分层 → 同层均匀分布 → 正交折线。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  MermaidFlowDiagram,
  MermaidFlowNode,
  MermaidFlowEdge,
} from '@/api/modules/recording/types'

// ============= 布局常量 =============

const MIN_NODE_W = 168
const MAX_NODE_W = 220
const LR_NODE_W = 190
// 视口 < 480 时节点可下探的下限：手机竖屏避免单节点就撑爆
const NARROW_MIN_NODE_W = 132
// 视口 < 480 时 TB 节点上限（推导自目标 totalW=330：2 节点 + COL_GAP + CANVAS_PAD*2
// = 2*X + 16 + 28 = 330 → X ≤ 143；3 节点更小，会被自然溢出，让 viewport 提供横向滚动条）
const NARROW_MAX_NODE_W = 143
const NODE_MIN_H = 68
const NODE_PAD_X = 12
const NODE_PAD_Y = 11

const COL_GAP = 16 // TB 同 rank 内节点水平间距
const RANK_GAP_TB = 38 // TB 不同 rank 之间的纵向间距
const ROW_GAP_LR = 16 // LR 同 rank 内节点垂直间距
const RANK_GAP_LR = 48 // LR 不同 rank 之间的横向间距
const CANVAS_PAD = 14

const SAFE_TONES = new Set([
  'neutral',
  'positive',
  'info',
  'warning',
  'danger',
  'critical',
  'pending',
])

function normalizeTone(tone: string | undefined): string {
  return tone && SAFE_TONES.has(tone) ? tone : 'neutral'
}

// ============= 布局算法 =============

interface Position {
  x: number
  y: number
  w: number
  h: number
}

interface LayoutInput {
  /** 节点宽（不同方向/可用宽度下不同） */
  nodeWidth: number
  /** 实测高度（首次渲染用 NODE_MIN_H 兜底） */
  heights: Map<string, number>
  /** 视口可用宽度；totalW 至少取这个值，让小图也能撑满视口居中（仿 meeting-recorder） */
  availableWidth?: number
}

interface Layout {
  width: number
  height: number
  positions: Map<string, Position>
  /** 该方向下"每 rank 自身高度"数组，供高度变化时增量重排 */
  rowHeights: number[]
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

/**
 * 根据 rank 分组 + 实测高度计算每个节点的最终坐标。
 * 高度变化时上下节点的 y 会随之平移，所以 edges 坐标也跟着走。
 */
function computeLayout(
  nodes: MermaidFlowNode[],
  isTB: boolean,
  input: LayoutInput,
): Layout {
  const positions = new Map<string, Position>()
  const groups = groupByRank(nodes)
  const ranks = Array.from(groups.keys()).sort((a, b) => a - b)
  if (ranks.length === 0) {
    return { width: 0, height: 0, positions, rowHeights: [] }
  }
  const maxPerRank = Math.max(1, ...Array.from(groups.values(), list => list.length))
  const nodeWidth = input.nodeWidth

  if (isTB) {
    // 先算每行的"行高"（该 rank 中所有节点的最大实测高度）
    const rowHeights = ranks.map(rank => {
      const list = groups.get(rank) || []
      return Math.max(NODE_MIN_H, ...list.map(n => input.heights.get(n.id) || NODE_MIN_H))
    })
    const totalRowH = rowHeights.reduce((a, b) => a + b, 0) + (ranks.length - 1) * RANK_GAP_TB
    // 窄屏（< 480）下把 availableWidth 钳到 330，避免 root.clientWidth 测出 334 等小数值时
    // totalW 被它带成 334，导致横向滚动条多滚几像素。330 是窄屏下 2 节点一行的「安全值」
    // （132*2 + 16 + 28 = 308，刚好放下，totalW 取大者保证居中留白）
    const safeAvailableWidth = (input.availableWidth || 330) < 480
      ? Math.min(330, input.availableWidth || 330)
      : (input.availableWidth || 330)
    // totalW 取视口可用宽度与内容宽度的较大者：内容更宽时滚动，内容更窄时撑满视口让节点自然居中（仿 meeting-recorder）
    const totalW = Math.max(
      safeAvailableWidth,
      maxPerRank * nodeWidth + (maxPerRank - 1) * COL_GAP + CANVAS_PAD * 2,
    )
    const totalH = Math.max(180, totalRowH + CANVAS_PAD * 2)

    let y = CANVAS_PAD
    ranks.forEach((rank, ri) => {
      const list = groups.get(rank) || []
      const rowH = rowHeights[ri]
      const listW = list.length * nodeWidth + (list.length - 1) * COL_GAP
      const startX = (totalW - listW) / 2
      list.forEach((node, i) => {
        const h = input.heights.get(node.id) || NODE_MIN_H
        // 行内垂直居中（虽然高度一致；保留居中逻辑方便未来混排）
        const localY = y + (rowH - h) / 2
        positions.set(node.id, {
          x: startX + i * (nodeWidth + COL_GAP),
          y: localY,
          w: nodeWidth,
          h,
        })
      })
      y += rowH + RANK_GAP_TB
    })

    return { width: totalW, height: totalH, positions, rowHeights }
  }

  // LR：rank 沿 X 轴展开，同 rank 内沿 Y 轴展开
  const colWidth = nodeWidth + RANK_GAP_LR
  // 同上：窄屏下钳到 330，避免 clientWidth 测得 334/360 等值时 totalW 被带大
  const safeAvailableWidth = (input.availableWidth || 330) < 480
    ? Math.min(330, input.availableWidth || 330)
    : (input.availableWidth || 330)
  // totalW 取视口可用宽度与内容宽度的较大者（仿 meeting-recorder）
  const totalW = Math.max(
    safeAvailableWidth,
    ranks.length * colWidth + CANVAS_PAD * 2 - RANK_GAP_LR,
  )
  // 每列的行高 = 该 rank 内所有节点高之和 + gap
  const colHeights = ranks.map(rank => {
    const list = groups.get(rank) || []
    return (
      list.reduce((sum, n) => sum + (input.heights.get(n.id) || NODE_MIN_H), 0) +
      Math.max(0, list.length - 1) * ROW_GAP_LR
    )
  })
  const totalH = Math.max(180, Math.max(...colHeights) + CANVAS_PAD * 2)

  ranks.forEach((rank, col) => {
    const list = groups.get(rank) || []
    const colH = colHeights[col]
    let y = (totalH - colH) / 2
    list.forEach(node => {
      const h = input.heights.get(node.id) || NODE_MIN_H
      positions.set(node.id, {
        x: CANVAS_PAD + col * colWidth,
        y,
        w: nodeWidth,
        h,
      })
      y += h + ROW_GAP_LR
    })
  })

  return { width: totalW, height: totalH, positions, rowHeights: colHeights }
}

// ============= 边的正交路径 =============

/** TB 走向：从 from 底部 → 中点 → to 顶部 */
function tbEdgePath(from: Position, to: Position): string {
  const x1 = from.x + from.w / 2
  const y1 = from.y + from.h
  const x2 = to.x + to.w / 2
  const y2 = to.y
  const midY = y1 + (y2 - y1) / 2
  return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`
}

/** LR 走向：从 from 右侧 → 中点 → to 左侧 */
function lrEdgePath(from: Position, to: Position): string {
  const x1 = from.x + from.w
  const y1 = from.y + from.h / 2
  const x2 = to.x
  const y2 = to.y + to.h / 2
  const midX = x1 + (x2 - x1) / 2
  return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
}

function edgePath(direction: 'TB' | 'LR', from: Position, to: Position): string {
  return direction === 'LR' ? lrEdgePath(from, to) : tbEdgePath(from, to)
}

/** 边标签位置：放在路径中点稍微偏上 */
function edgeLabelPosition(
  direction: 'TB' | 'LR',
  from: Position,
  to: Position,
): { x: number; y: number } {
  if (direction === 'TB') {
    const midY = (from.y + from.h + to.y) / 2
    const x = (from.x + from.w / 2 + to.x + to.w / 2) / 2
    return { x, y: midY - 4 }
  }
  const midX = (from.x + from.w + to.x) / 2
  const y = (from.y + from.h / 2 + to.y + to.h / 2) / 2
  return { x: midX, y: y - 4 }
}

// ============= 组件 =============

interface MermaidFlowRendererProps {
  diagram: MermaidFlowDiagram
  /** 外部容器 className（用于嵌套在 .insight-card 内） */
  className?: string
}

export function MermaidFlowRenderer({ diagram, className }: MermaidFlowRendererProps) {
  // 守卫（仿 meeting-recorder）：nodes 和 edges 都必须是数组且非空；hooks 之前先校验，但 hooks 仍要无条件调用
  const safeDiagram =
    diagram &&
    Array.isArray(diagram.nodes) &&
    Array.isArray(diagram.edges) &&
    diagram.nodes.length > 0 &&
    diagram.edges.length > 0
      ? diagram
      : null

  const containerRef = useRef<HTMLDivElement>(null)
  /** 实测高度：首次渲染用 NODE_MIN_H 兜底，mount 后 useLayoutEffect 校正 */
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number>>(new Map())
  const [nodeWidth, setNodeWidth] = useState<number>(LR_NODE_W)
  /** 视口可用宽度：用于把 flow 容器撑到与视口同宽，让小图节点自然居中（仿 meeting-recorder）
   *  ref 挂在 .insight-mermaid-viewport 上 —— viewport 的 clientWidth 随窗口缩放/侧栏折叠变化，
   *  ResizeObserver 才能稳定触发；flow 自身有 inline width，观察它不会随窗口变化。 */
  const [availableWidth, setAvailableWidth] = useState<number>(330)

  const isTB = safeDiagram?.direction !== 'LR'

  // 节点排序：rank 升序，rank 相同时 id 字典序；保证渲染顺序稳定（仿 meeting-recorder）
  const sortedNodes = useMemo(() => {
    if (!safeDiagram) return []
    return [...safeDiagram.nodes].sort(
      (a, b) =>
        (Number(a.rank || 0) - Number(b.rank || 0)) ||
        String(a.id).localeCompare(String(b.id)),
    )
  }, [safeDiagram])

  // 首次 mount 后：用 offsetHeight 校正每个节点高度 + 可用宽度重算 nodeWidth + 记录 availableWidth
  useLayoutEffect(() => {
    if (!containerRef.current || !safeDiagram) return
    const root = containerRef.current
    // 注意：root.clientWidth=0 时不能用 `|| 600`，否则会把布局算成 600 撑爆窄屏。
    // 真实为 0（首帧未布局完成）时按 330 兜底，与 min(MAX_NODE_W) 保持兼容
    const measuredAvailableWidth = root.clientWidth > 0
      ? root.clientWidth
      : 330
    const newWidth = computeNodeWidth(
      measuredAvailableWidth,
      isTB,
      countMaxRankSize(safeDiagram.nodes),
    )

    const heights = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach(el => {
      const id = el.dataset.flowNodeId
      if (!id) return
      heights.set(id, Math.max(NODE_MIN_H, el.offsetHeight))
    })

    const heightChanged =
      heights.size !== measuredHeights.size ||
      Array.from(heights.entries()).some(([k, v]) => measuredHeights.get(k) !== v)
    const widthChanged = newWidth !== nodeWidth
    const availableWidthChanged = measuredAvailableWidth !== availableWidth
    if (heightChanged) setMeasuredHeights(heights)
    if (widthChanged) setNodeWidth(newWidth)
    if (availableWidthChanged) setAvailableWidth(measuredAvailableWidth)
  })

  // 视口尺寸变化时（窗口缩放 / 侧栏折叠 / 父容器 resize）重新测量并触发重排（仿 meeting-recorder）
  useEffect(() => {
    if (!containerRef.current || !safeDiagram) return
    if (typeof ResizeObserver === 'undefined') return
    const root = containerRef.current
    const remeasure = () => {
      // 同上：clientWidth=0 时按 330 兜底，而不是 600（窄屏下 600 会撑爆视口）
      const measuredAvailableWidth = root.clientWidth > 0
        ? root.clientWidth
        : 330
      const newWidth = computeNodeWidth(
        measuredAvailableWidth,
        isTB,
        countMaxRankSize(safeDiagram.nodes),
      )
      const heights = new Map<string, number>()
      root.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach(el => {
        const id = el.dataset.flowNodeId
        if (!id) return
        heights.set(id, Math.max(NODE_MIN_H, el.offsetHeight))
      })
      // 仅在数值真正变化时 setState，避免 ResizeObserver + 自身 layout 引发死循环
      setMeasuredHeights(prev => {
        if (
          prev.size !== heights.size ||
          Array.from(heights.entries()).some(([k, v]) => prev.get(k) !== v)
        ) {
          return heights
        }
        return prev
      })
      setNodeWidth(prev => (prev === newWidth ? prev : newWidth))
      setAvailableWidth(prev => (prev === measuredAvailableWidth ? prev : measuredAvailableWidth))
    }
    const observer = new ResizeObserver(remeasure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [safeDiagram, isTB])

  const layout = useMemo(
    () =>
      computeLayout(sortedNodes, !!isTB, {
        nodeWidth,
        heights: measuredHeights,
        availableWidth,
      }),
    [sortedNodes, isTB, nodeWidth, measuredHeights, availableWidth],
  )

  if (!safeDiagram) return null

  // 边标签
  const renderEdge = (edge: MermaidFlowEdge, idx: number) => {
    const fromPos = layout.positions.get(edge.from)
    const toPos = layout.positions.get(edge.to)
    if (!fromPos || !toPos) return null
    const d = edgePath(safeDiagram.direction, fromPos, toPos)
    const labelPos = edge.label ? edgeLabelPosition(safeDiagram.direction, fromPos, toPos) : null
    return (
      <g key={`e-${idx}`}>
        <path
          d={d}
          fill="none"
          stroke="rgba(148,163,184,.78)"
          strokeWidth={1.8}
          markerEnd="url(#insight-flow-arrow)"
        />
        {labelPos && edge.label && (
          <text
            x={labelPos.x}
            y={labelPos.y}
            textAnchor="middle"
            className="insight-flow-edge-label"
          >
            {edge.label}
          </text>
        )}
      </g>
    )
  }

  return (
    <div ref={containerRef} className="insight-mermaid-viewport">
      <div
        className={`insight-mermaid-flow ${className || ''}`}
        style={{ position: 'relative', width: layout.width, height: layout.height }}
      >
        <svg
          className="insight-flow-lines"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="insight-flow-arrow"
              markerWidth={7}
              markerHeight={7}
              refX={6}
              refY={3.5}
              orient="auto"
            >
              <path d="M 0 0 L 7 3.5 L 0 7 z" fill="rgba(148,163,184,.85)" />
            </marker>
          </defs>
          {safeDiagram.edges.map(renderEdge)}
        </svg>
        {safeDiagram.nodes.map(node => {
          const pos = layout.positions.get(node.id)
          if (!pos) return null
          const tone = normalizeTone(node.tone)
          const title = (node.title || node.id).trim()
          const content = (node.content || '').trim()
          return (
            <article
              key={node.id}
              data-flow-node-id={node.id}
              className={`insight-flow-node tone-${tone}`}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: pos.w,
              }}
            >
              <strong className="insight-flow-node-title">{title}</strong>
              {content && <div className="insight-flow-node-body">{content}</div>}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function countMaxRankSize(nodes: MermaidFlowNode[]): number {
  const groups = new Map<number, number>()
  for (const node of nodes) {
    groups.set(node.rank, (groups.get(node.rank) || 0) + 1)
  }
  return Math.max(1, ...Array.from(groups.values()))
}

/**
 * 根据视口可用宽度 + 方向，计算单个节点的目标宽度。
 *
 * - TB：等分每 rank 内节点（最多 `maxPerRank` 个），下限 MIN_NODE_W / NARROW_MIN_NODE_W，上限 MAX_NODE_W
 * - LR：每 rank 1 列，节点宽 = min(LR_NODE_W, 可用宽度 - 边距)，下限 MIN_NODE_W
 *
 * 当视口 < 480 时，TB / LR 方向的最小宽度都允许下探到 NARROW_MIN_NODE_W，
 * 避免窄屏上 2 个节点一行就撑出 380px 视口，让用户横向滚动条能少滚一截。
 */
function computeNodeWidth(
  availableWidth: number,
  isTB: boolean,
  maxPerRank: number,
): number {
  const isNarrow = availableWidth < 480
  const narrowFloor = isNarrow ? NARROW_MIN_NODE_W : MIN_NODE_W
  if (isTB) {
    // 窄屏用 NARROW_MAX_NODE_W（143）当上限，确保 2 节点时 contentWidth ≤ 330；
    // 3+ 节点会算出更小值然后被 narrowFloor 兜住，totalW 自然超出 330，由 viewport 滚动条接管
    const tbMaxW = isNarrow ? NARROW_MAX_NODE_W : MAX_NODE_W
    return Math.min(
      tbMaxW,
      Math.max(
        narrowFloor,
        Math.floor(
          (availableWidth - 24 - (maxPerRank - 1) * COL_GAP) /
            Math.max(1, maxPerRank),
        ),
      ),
    )
  }
  return Math.min(
    LR_NODE_W,
    Math.max(narrowFloor, Math.floor(availableWidth - CANVAS_PAD * 2 - 24)),
  )
}

export default MermaidFlowRenderer