/**
 * 非流程图类 Mermaid 方言的渲染器（sequence / pie / gantt / timeline）
 *
 * 与 MermaidFlowRenderer 同样是纯本地实现，不引入 mermaid 运行时：
 * 解析器已经把源码归一化成结构化数据，这里只负责排版。
 * 配色沿用 insight 卡片的浅色系，保证同一页面里观感一致。
 */
import React from 'react'
import type {
  MermaidGanttDiagram,
  MermaidPieDiagram,
  MermaidSequenceDiagram,
  MermaidTimelineDiagram,
  ParsedMermaid,
} from './mermaidDiagramParser'
import { MermaidFlowRenderer } from './mermaidFlowRenderer'

// ============= 公共工具 =============

/** 超长文本截断（SVG 里没有自动换行，先保证不溢出） */
function truncate(text: string, max: number): string {
  const value = (text || '').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

const INK = '#1d2b3e'
const MUTED = '#64748b'
const LINE = '#cbd5e1'

// ============= sequenceDiagram =============

const SEQ_PAD = 20
const SEQ_COL_W = 168
const SEQ_HEAD_W = 132
const SEQ_HEAD_H = 38
const SEQ_ROW_H = 44
const SEQ_GROUP_H = 30
const SEQ_NOTE_H = 38
const SEQ_SELF_W = 46

interface SeqRow {
  y: number
  height: number
  item: MermaidSequenceDiagram['items'][number]
}

export function MermaidSequenceRenderer({ diagram }: { diagram: MermaidSequenceDiagram }) {
  const { participants, items, title } = diagram
  const columnX = new Map<string, number>()
  participants.forEach((p, i) => {
    columnX.set(p.id, SEQ_PAD + SEQ_COL_W / 2 + i * SEQ_COL_W)
  })

  const titleH = title ? 26 : 0
  const headTop = SEQ_PAD + titleH
  let cursor = headTop + SEQ_HEAD_H + 18
  const rows: SeqRow[] = []
  for (const item of items) {
    const height =
      item.kind === 'group' ? SEQ_GROUP_H : item.kind === 'note' ? SEQ_NOTE_H : SEQ_ROW_H
    rows.push({ y: cursor, height, item })
    cursor += height
  }

  const width = Math.max(360, SEQ_PAD * 2 + participants.length * SEQ_COL_W)
  const height = cursor + SEQ_PAD
  const lifelineBottom = height - SEQ_PAD

  return (
    <div className="insight-mermaid-viewport">
      <div className="insight-mermaid-sequence">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={title || '时序图'}
      >
        <defs>
          <marker
            id="insight-seq-arrow"
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

        {title && (
          <text x={width / 2} y={SEQ_PAD + 6} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>
            {truncate(title, 40)}
          </text>
        )}

        {/* 生命线 */}
        {participants.map(p => {
          const x = columnX.get(p.id)!
          return (
            <line
              key={`life-${p.id}`}
              x1={x}
              y1={headTop + SEQ_HEAD_H}
              x2={x}
              y2={lifelineBottom}
              stroke={LINE}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )
        })}

        {/* 参与者头部 */}
        {participants.map(p => {
          const x = columnX.get(p.id)!
          return (
            <g key={`head-${p.id}`}>
              <rect
                x={x - SEQ_HEAD_W / 2}
                y={headTop}
                width={SEQ_HEAD_W}
                height={SEQ_HEAD_H}
                rx={p.actor ? 18 : 8}
                ry={p.actor ? 18 : 8}
                fill="#eff6ff"
                stroke="#3b82f6"
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={headTop + SEQ_HEAD_H / 2 + 4}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="#1e3a8a"
              >
                {truncate(p.label, 14)}
                <title>{p.label}</title>
              </text>
            </g>
          )
        })}

        {/* 消息 / 备注 / 分组 */}
        {rows.map((row, idx) => {
          const { item } = row
          if (item.kind === 'group') {
            return (
              <g key={`row-${idx}`}>
                <line
                  x1={SEQ_PAD}
                  y1={row.y + row.height / 2}
                  x2={width - SEQ_PAD}
                  y2={row.y + row.height / 2}
                  stroke={LINE}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
                <rect
                  x={SEQ_PAD}
                  y={row.y + 4}
                  width={Math.min(width - SEQ_PAD * 2, 86 + item.label.length * 8)}
                  height={row.height - 8}
                  rx={4}
                  fill="#f1f5f9"
                  stroke={LINE}
                />
                <text x={SEQ_PAD + 8} y={row.y + row.height / 2 + 4} fontSize={11} fontWeight={600} fill={MUTED}>
                  {`${item.keyword.toUpperCase()} ${truncate(item.label, 24)}`.trim()}
                </text>
              </g>
            )
          }

          if (item.kind === 'note') {
            const xs = item.targets.map(t => columnX.get(t)).filter((v): v is number => v != null)
            const left = xs.length > 0 ? Math.min(...xs) : SEQ_PAD
            const right = xs.length > 0 ? Math.max(...xs) : width - SEQ_PAD
            const boxLeft =
              item.placement === 'left'
                ? left - SEQ_COL_W + 12
                : item.placement === 'right'
                  ? right + 12
                  : left - SEQ_HEAD_W / 2
            const boxWidth =
              item.placement === 'over'
                ? Math.max(SEQ_HEAD_W, right - left + SEQ_HEAD_W)
                : SEQ_COL_W - 24
            return (
              <g key={`row-${idx}`}>
                <rect
                  x={Math.max(4, boxLeft)}
                  y={row.y + 4}
                  width={Math.min(boxWidth, width - 8)}
                  height={row.height - 10}
                  rx={6}
                  fill="#fffbeb"
                  stroke="#f59e0b"
                  strokeWidth={1}
                />
                <text
                  x={Math.max(4, boxLeft) + 10}
                  y={row.y + row.height / 2 + 3}
                  fontSize={11}
                  fill="#78350f"
                >
                  {truncate(item.text, 40)}
                  <title>{item.text}</title>
                </text>
              </g>
            )
          }

          const fromX = columnX.get(item.from)
          const toX = columnX.get(item.to)
          if (fromX == null || toX == null) return null
          const label = item.index > 0 ? `${item.index}. ${item.text}` : item.text
          const lineY = row.y + row.height - 12

          // 自己发给自己：画一个向右的回环
          if (item.from === item.to) {
            const path = `M ${fromX} ${lineY - 18} L ${fromX + SEQ_SELF_W} ${lineY - 18} L ${fromX + SEQ_SELF_W} ${lineY} L ${fromX + 4} ${lineY}`
            return (
              <g key={`row-${idx}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth={1.4}
                  strokeDasharray={item.dashed ? '5 4' : undefined}
                  markerEnd="url(#insight-seq-arrow)"
                />
                <text x={fromX + SEQ_SELF_W + 8} y={lineY - 8} fontSize={11} fill={INK}>
                  {truncate(label, 20)}
                  <title>{label}</title>
                </text>
              </g>
            )
          }

          return (
            <g key={`row-${idx}`}>
              <text
                x={(fromX + toX) / 2}
                y={lineY - 7}
                textAnchor="middle"
                fontSize={11}
                fill={INK}
              >
                {truncate(label, Math.max(12, Math.floor(Math.abs(toX - fromX) / 12)))}
                <title>{label}</title>
              </text>
              <line
                x1={fromX}
                y1={lineY}
                x2={toX}
                y2={lineY}
                stroke="#94a3b8"
                strokeWidth={1.4}
                strokeDasharray={item.dashed ? '5 4' : undefined}
                markerEnd="url(#insight-seq-arrow)"
              />
            </g>
          )
        })}
      </svg>
    </div>
    </div>
  )
}

// ============= pie =============

const PIE_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#64748b',
]

const PIE_SIZE = 220
const PIE_R = 92

/** 极坐标 → 直角坐标（12 点方向为 0°，顺时针） */
function polar(cx: number, cy: number, r: number, ratio: number): [number, number] {
  const angle = ratio * Math.PI * 2 - Math.PI / 2
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

export function MermaidPieRenderer({ diagram }: { diagram: MermaidPieDiagram }) {
  const { slices, total, title, showData } = diagram
  const cx = PIE_SIZE / 2
  const cy = PIE_SIZE / 2
  let acc = 0

  return (
    <div className="insight-mermaid-viewport">
      <div className="insight-mermaid-pie">
        {title && <div className="insight-mermaid-pie-title">{title}</div>}
        <div className="insight-mermaid-pie-body">
          <svg
            width={PIE_SIZE}
            height={PIE_SIZE}
            viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={title || '饼图'}
          >
            {slices.map((slice, i) => {
              const startRatio = acc / total
              acc += slice.value
              const endRatio = acc / total
              const color = PIE_COLORS[i % PIE_COLORS.length]
              // 单一扇区占满整圆时 arc 画不出来，直接画整圆
              if (endRatio - startRatio >= 0.999) {
                return <circle key={slice.label} cx={cx} cy={cy} r={PIE_R} fill={color} />
              }
              const [x1, y1] = polar(cx, cy, PIE_R, startRatio)
              const [x2, y2] = polar(cx, cy, PIE_R, endRatio)
              const largeArc = endRatio - startRatio > 0.5 ? 1 : 0
              const d = `M ${cx} ${cy} L ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${x2} ${y2} Z`
              return (
                <path key={slice.label} d={d} fill={color} stroke="#ffffff" strokeWidth={1.5}>
                  <title>
                    {slice.label}: {`${((slice.value / total) * 100).toFixed(1)}%`}
                    {showData ? ` (${slice.value})` : ''}
                  </title>
                </path>
              )
            })}
          </svg>
          <ul className="insight-mermaid-pie-legend">
            {slices.map((slice, i) => (
              <li key={slice.label}>
                <span
                  className="insight-mermaid-pie-swatch"
                  style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                <span className="insight-mermaid-pie-label">{slice.label}</span>
                <span className="insight-mermaid-pie-value">
                  {showData ? `${slice.value} · ` : ''}
                  {`${((slice.value / total) * 100).toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ============= gantt =============

export function MermaidGanttRenderer({ diagram }: { diagram: MermaidGanttDiagram }) {
  const { sections, title, min, max } = diagram
  const span = max - min || 1
  const pct = (value: number) => `${((value - min) / span) * 100}%`

  return (
    <div className="insight-mermaid-viewport">
      <div className="insight-mermaid-gantt">
        {title && <div className="insight-mermaid-gantt-title">{title}</div>}
        {sections.map((section, si) => (
          <div className="insight-mermaid-gantt-section" key={`${section.name}-${si}`}>
            {section.name && <div className="insight-mermaid-gantt-section-name">{section.name}</div>}
            {section.tasks.map(task => {
              const milestone = task.status === 'milestone' || task.end === task.start
              const width = milestone ? undefined : `${((task.end - task.start) / span) * 100}%`
              const range = [task.startLabel, task.endLabel].filter(Boolean).join(' → ')
              return (
                <div className="insight-mermaid-gantt-row" key={task.id}>
                  <span className="insight-mermaid-gantt-label" title={task.name}>
                    {task.name}
                  </span>
                  <span className="insight-mermaid-gantt-track">
                    <span
                      className={`insight-mermaid-gantt-bar is-${task.status}${milestone ? ' is-point' : ''}`}
                      style={{ left: pct(task.start), width }}
                      title={range || task.name}
                    />
                  </span>
                  {range && <span className="insight-mermaid-gantt-date">{range}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============= timeline =============

export function MermaidTimelineRenderer({ diagram }: { diagram: MermaidTimelineDiagram }) {
  const { sections, title } = diagram
  return (
    <div className="insight-mermaid-viewport">
      <div className="insight-mermaid-timeline">
        {title && <div className="insight-mermaid-timeline-title">{title}</div>}
        {sections.map((section, si) => (
          <div className="insight-mermaid-timeline-section" key={`${section.name}-${si}`}>
            {section.name && (
              <div className="insight-mermaid-timeline-section-name">{section.name}</div>
            )}
            <ol className="insight-mermaid-timeline-list">
              {section.events.map((event, ei) => (
                <li className="insight-mermaid-timeline-event" key={`${event.time}-${ei}`}>
                  <span className="insight-mermaid-timeline-time">{event.time}</span>
                  {event.items.length > 0 && (
                    <span className="insight-mermaid-timeline-items">
                      {event.items.map((text, ii) => (
                        <span className="insight-mermaid-timeline-item" key={`${text}-${ii}`}>
                          {text}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============= 分发 =============

/** 按 kind 分发到具体渲染器；flow 家族继续复用 MermaidFlowRenderer */
export function MermaidDiagram({ diagram, className }: { diagram: ParsedMermaid; className?: string }) {
  if (!diagram) return null
  switch (diagram.kind) {
    case 'flow':
      return <MermaidFlowRenderer diagram={diagram.diagram} className={className} />
    case 'sequence':
      return <MermaidSequenceRenderer diagram={diagram} />
    case 'pie':
      return <MermaidPieRenderer diagram={diagram} />
    case 'gantt':
      return <MermaidGanttRenderer diagram={diagram} />
    case 'timeline':
      return <MermaidTimelineRenderer diagram={diagram} />
    default:
      return null
  }
}

export default MermaidDiagram
