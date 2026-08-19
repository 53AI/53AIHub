/**
 * Mermaid 多方言解析入口
 *
 * insight 卡片里出现的 mermaid 不止 flowchart，因此这里做统一分发：
 *
 *   flowchart / graph              → MermaidFlowDiagram（mermaidFlowchartParser）
 *   stateDiagram / classDiagram
 *   / mindmap                      → MermaidFlowDiagram（mermaidGraphParsers，图结构同构）
 *   sequenceDiagram                → MermaidSequenceDiagram
 *   pie                            → MermaidPieDiagram
 *   gantt                          → MermaidGanttDiagram
 *   timeline                       → MermaidTimelineDiagram
 *
 * 任何解析失败都返回 null，由调用方降级为代码块渲染——
 * 宁可展示源码，也不要把半张错图画给用户。
 */
import type { MermaidFlowDiagram } from '@/api/modules/recording/types'
import { isMermaidFlowchart, parseMermaidFlowchart } from './mermaidFlowchartParser'
import {
  isClassDiagram,
  isMindmap,
  isStateDiagram,
  parseClassDiagram,
  parseMindmap,
  parseStateDiagram,
} from './mermaidGraphParsers'

// ============= 类型 =============

export type MermaidDiagramType =
  | 'flowchart'
  | 'state'
  | 'class'
  | 'mindmap'
  | 'sequence'
  | 'pie'
  | 'gantt'
  | 'timeline'
  | 'unknown'

/** 时序图的一条消息 */
export interface MermaidSequenceMessage {
  kind: 'message'
  from: string
  to: string
  text: string
  /** 虚线箭头（-->> / --> / --x / --)） */
  dashed: boolean
  /** autonumber 开启时的序号，从 1 开始；未开启为 0 */
  index: number
}

/** 时序图的备注块 */
export interface MermaidSequenceNote {
  kind: 'note'
  placement: 'over' | 'left' | 'right'
  targets: string[]
  text: string
}

/** loop / alt / opt / par 等分组的标题行（渲染成一条带标签的横幅） */
export interface MermaidSequenceGroup {
  kind: 'group'
  keyword: string
  label: string
}

export type MermaidSequenceItem =
  | MermaidSequenceMessage
  | MermaidSequenceNote
  | MermaidSequenceGroup

export interface MermaidSequenceDiagram {
  kind: 'sequence'
  title: string
  participants: Array<{ id: string; label: string; actor: boolean }>
  items: MermaidSequenceItem[]
  source: string
}

export interface MermaidPieDiagram {
  kind: 'pie'
  title: string
  showData: boolean
  slices: Array<{ label: string; value: number }>
  total: number
  source: string
}

export interface MermaidGanttTask {
  id: string
  name: string
  status: 'default' | 'done' | 'active' | 'crit' | 'milestone'
  /** 以"天"为单位的相对起止；无日期时退化为顺序位置 */
  start: number
  end: number
  startLabel: string
  endLabel: string
}

export interface MermaidGanttDiagram {
  kind: 'gantt'
  title: string
  sections: Array<{ name: string; tasks: MermaidGanttTask[] }>
  /** 是否解析出真实日期（否则按顺序等宽排列） */
  hasDates: boolean
  min: number
  max: number
  source: string
}

export interface MermaidTimelineDiagram {
  kind: 'timeline'
  title: string
  sections: Array<{ name: string; events: Array<{ time: string; items: string[] }> }>
  source: string
}

export interface MermaidFlowWrapper {
  kind: 'flow'
  /** 具体方言，用于渲染层微调（例如 mindmap 不画箭头标签） */
  dialect: 'flowchart' | 'state' | 'class' | 'mindmap'
  diagram: MermaidFlowDiagram
}

export type ParsedMermaid =
  | MermaidFlowWrapper
  | MermaidSequenceDiagram
  | MermaidPieDiagram
  | MermaidGanttDiagram
  | MermaidTimelineDiagram

// ============= 通用工具 =============

function toLines(source: string): string[] {
  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.replace(/%%.*$/, ''))
}

/** 去掉成对引号（mermaid 里引号只是转义手段） */
function unquote(raw: string): string {
  const s = (raw || '').trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).trim()
  return s
}

// ============= 类型识别 =============

const TYPE_PATTERNS: Array<[RegExp, MermaidDiagramType]> = [
  [/^(?:flowchart|graph)\s+/i, 'flowchart'],
  [/^sequenceDiagram\b/i, 'sequence'],
  [/^pie\b/i, 'pie'],
  [/^gantt\b/i, 'gantt'],
  [/^timeline\b/i, 'timeline'],
  [/^stateDiagram(?:-v2)?\b/i, 'state'],
  [/^classDiagram(?:-v2)?\b/i, 'class'],
  [/^mindmap\b/i, 'mindmap'],
]

/** 扫描源码首个有效行，判断 mermaid 方言 */
export function detectMermaidType(source: string): MermaidDiagramType {
  for (const line of toLines(source)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('```')) continue
    for (const [re, type] of TYPE_PATTERNS) {
      if (re.test(trimmed)) return type
    }
    // 首个有效行不是任何已知头部 → 无法识别，不再继续猜
    return 'unknown'
  }
  return 'unknown'
}

// ============= sequenceDiagram =============

/**
 * 箭头：长的排前面，避免 `->` 抢先匹配 `->>`。
 * 参与者 id 用 `\w*(?:-\w+)*` 而不是 `[\w-]*`，否则 `B-->>A` 里的 `B-`
 * 会被当成 id 吞掉一截箭头。
 */
const SEQ_ARROW_RE =
  /^([A-Za-z_]\w*(?:-\w+)*)\s*(-->>|--\)|--x|-->|->>|-\)|-x|->)\s*([A-Za-z_]\w*(?:-\w+)*)\s*:\s*([\s\S]*)$/
const SEQ_GROUP_RE = /^(loop|alt|else|opt|par|and|critical|option|rect|break)\b\s*(.*)$/i
const SEQ_NOTE_RE = /^note\s+(over|left\s+of|right\s+of)\s+([^:]+):\s*([\s\S]*)$/i

export function parseSequenceDiagram(source: string): MermaidSequenceDiagram {
  const lines = toLines(source)
  const headerIndex = lines.findIndex(l => /^\s*sequenceDiagram\b/i.test(l))
  if (headerIndex < 0) throw new Error('not a sequenceDiagram')

  const participants: Array<{ id: string; label: string; actor: boolean }> = []
  const seen = new Map<string, { id: string; label: string; actor: boolean }>()
  const items: MermaidSequenceItem[] = []
  let title = ''
  let autonumber = false
  let messageSeq = 0

  const touch = (id: string, label = '', actor = false) => {
    const existing = seen.get(id)
    if (existing) {
      if (label && existing.label === existing.id) existing.label = label
      if (actor) existing.actor = true
      return
    }
    const created = { id, label: label || id, actor }
    seen.set(id, created)
    participants.push(created)
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('```')) continue
    if (/^autonumber\b/i.test(line)) {
      autonumber = true
      continue
    }
    const titleMatch = line.match(/^title\s+(.*)$/i)
    if (titleMatch) {
      title = titleMatch[1].trim()
      continue
    }
    // participant A as Alice / actor B
    const actorDecl = line.match(/^(participant|actor)\s+([A-Za-z_]\w*(?:-\w+)*)(?:\s+as\s+(.*))?$/i)
    if (actorDecl) {
      touch(actorDecl[2], unquote(actorDecl[3] || ''), actorDecl[1].toLowerCase() === 'actor')
      continue
    }
    if (/^(?:activate|deactivate|destroy|link|links)\b/i.test(line)) continue
    if (/^end$/i.test(line)) continue

    const note = line.match(SEQ_NOTE_RE)
    if (note) {
      const placementRaw = note[1].toLowerCase()
      const placement = placementRaw.startsWith('left')
        ? 'left'
        : placementRaw.startsWith('right')
          ? 'right'
          : 'over'
      const targets = note[2]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      for (const t of targets) touch(t)
      items.push({ kind: 'note', placement, targets, text: note[3].trim() })
      continue
    }

    const message = line.match(SEQ_ARROW_RE)
    if (message) {
      const [, from, arrow, to, text] = message
      touch(from)
      touch(to)
      items.push({
        kind: 'message',
        from,
        to,
        text: text.trim(),
        dashed: arrow.startsWith('--'),
        index: autonumber ? ++messageSeq : 0,
      })
      continue
    }

    const group = line.match(SEQ_GROUP_RE)
    if (group) {
      items.push({ kind: 'group', keyword: group[1].toLowerCase(), label: group[2].trim() })
      continue
    }
  }

  if (participants.length === 0) throw new Error('no participants parsed')
  return { kind: 'sequence', title, participants, items, source: String(source || '').trim() }
}

// ============= pie =============

export function parsePieChart(source: string): MermaidPieDiagram {
  const lines = toLines(source)
  const headerIndex = lines.findIndex(l => /^\s*pie\b/i.test(l))
  if (headerIndex < 0) throw new Error('not a pie chart')

  const header = lines[headerIndex].trim()
  const showData = /\bshowData\b/i.test(header)
  let title = (header.match(/\btitle\s+(.*)$/i)?.[1] || '').trim()
  const slices: Array<{ label: string; value: number }> = []

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('```')) continue
    const titleMatch = line.match(/^title\s+(.*)$/i)
    if (titleMatch) {
      title = titleMatch[1].trim()
      continue
    }
    const slice = line.match(/^"?([^":]+?)"?\s*:\s*([\d.]+)\s*$/)
    if (!slice) continue
    const value = Number.parseFloat(slice[2])
    if (!Number.isFinite(value) || value < 0) continue
    slices.push({ label: unquote(slice[1]), value })
  }

  if (slices.length === 0) throw new Error('no pie slices parsed')
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) throw new Error('pie total is zero')
  return { kind: 'pie', title, showData, slices, total, source: String(source || '').trim() }
}

// ============= gantt =============

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|M|y)$/
const GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone'])

/** 把 mermaid 时长（1d/2w/8h…）折算成天 */
function durationToDays(token: string): number | null {
  const m = token.match(DURATION_RE)
  if (!m) return null
  const value = Number.parseFloat(m[1])
  switch (m[2]) {
    case 'ms': return value / DAY_MS
    case 's': return value / 86400
    case 'm': return value / 1440
    case 'h': return value / 24
    case 'd': return value
    case 'w': return value * 7
    case 'M': return value * 30
    case 'y': return value * 365
    default: return null
  }
}

function dateToDays(token: string): number | null {
  if (!DATE_RE.test(token)) return null
  const ms = Date.parse(`${token}T00:00:00Z`)
  return Number.isFinite(ms) ? ms / DAY_MS : null
}

function daysToDate(days: number): string {
  const iso = new Date(Math.round(days * DAY_MS)).toISOString()
  return iso.slice(0, 10)
}

/**
 * gantt → MermaidGanttDiagram
 *
 * 支持 `任务名 : [标签,] [id,] 起点, 终点/时长`，起点可以是日期或 `after <id>`。
 * 完全解析不出日期时（自定义 dateFormat 等）退化成"按顺序等宽排列"，
 * 保证仍然能看到任务清单与分组，而不是直接崩掉。
 */
export function parseGanttDiagram(source: string): MermaidGanttDiagram {
  const lines = toLines(source)
  const headerIndex = lines.findIndex(l => /^\s*gantt\b/i.test(l))
  if (headerIndex < 0) throw new Error('not a gantt chart')

  let title = ''
  const sections: Array<{ name: string; tasks: MermaidGanttTask[] }> = []
  const taskEnd = new Map<string, number>()
  let hasDates = false
  let cursor = 0
  let anonymous = 0

  const currentSection = (): { name: string; tasks: MermaidGanttTask[] } => {
    if (sections.length === 0) sections.push({ name: '', tasks: [] })
    return sections[sections.length - 1]
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('```')) continue
    const titleMatch = line.match(/^title\s+(.*)$/i)
    if (titleMatch) {
      title = titleMatch[1].trim()
      continue
    }
    if (/^(?:dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday)\b/i.test(line)) {
      continue
    }
    const sectionMatch = line.match(/^section\s+(.*)$/i)
    if (sectionMatch) {
      sections.push({ name: sectionMatch[1].trim(), tasks: [] })
      continue
    }
    const colonIndex = line.indexOf(':')
    if (colonIndex < 0) continue

    const name = line.slice(0, colonIndex).trim()
    const tokens = line
      .slice(colonIndex + 1)
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    let status: MermaidGanttTask['status'] = 'default'
    let id = ''
    let start: number | null = null
    let end: number | null = null
    let duration: number | null = null

    for (const token of tokens) {
      const lower = token.toLowerCase()
      if (GANTT_TAGS.has(lower)) {
        status = lower as MermaidGanttTask['status']
        continue
      }
      const afterMatch = token.match(/^after\s+(.+)$/i)
      if (afterMatch) {
        const refs = afterMatch[1].split(/\s+/).map(r => taskEnd.get(r)).filter((v): v is number => v != null)
        if (refs.length > 0) start = Math.max(...refs)
        continue
      }
      const asDate = dateToDays(token)
      if (asDate != null) {
        hasDates = true
        if (start == null) start = asDate
        else end = asDate
        continue
      }
      const asDuration = durationToDays(token)
      if (asDuration != null) {
        duration = asDuration
        continue
      }
      if (!id && /^[A-Za-z_][\w-]*$/.test(token)) id = token
    }

    // 没有任何时间信息 → 顺序排列，宽度 1
    const resolvedStart = start ?? cursor
    const resolvedEnd = end ?? resolvedStart + (duration ?? (status === 'milestone' ? 0 : 1))
    cursor = Math.max(cursor, resolvedEnd)

    const taskId = id || `task-${anonymous++}`
    taskEnd.set(taskId, resolvedEnd)
    currentSection().tasks.push({
      id: taskId,
      name,
      status,
      start: resolvedStart,
      end: resolvedEnd,
      startLabel: hasDates && start != null ? daysToDate(resolvedStart) : '',
      endLabel: hasDates && (end != null || duration != null) ? daysToDate(resolvedEnd) : '',
    })
  }

  const tasks = sections.flatMap(s => s.tasks)
  if (tasks.length === 0) throw new Error('no gantt tasks parsed')
  const min = Math.min(...tasks.map(t => t.start))
  const max = Math.max(...tasks.map(t => t.end))
  return {
    kind: 'gantt',
    title,
    sections,
    hasDates,
    min,
    max: max > min ? max : min + 1,
    source: String(source || '').trim(),
  }
}

// ============= timeline =============

export function parseTimelineDiagram(source: string): MermaidTimelineDiagram {
  const lines = toLines(source)
  const headerIndex = lines.findIndex(l => /^\s*timeline\b/i.test(l))
  if (headerIndex < 0) throw new Error('not a timeline')

  let title = (lines[headerIndex].trim().match(/^timeline\s+title\s+(.*)$/i)?.[1] || '').trim()
  const sections: Array<{ name: string; events: Array<{ time: string; items: string[] }> }> = []

  const currentSection = () => {
    if (sections.length === 0) sections.push({ name: '', events: [] })
    return sections[sections.length - 1]
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('```')) continue
    const titleMatch = line.match(/^title\s+(.*)$/i)
    if (titleMatch) {
      title = titleMatch[1].trim()
      continue
    }
    const sectionMatch = line.match(/^section\s+(.*)$/i)
    if (sectionMatch) {
      sections.push({ name: sectionMatch[1].trim(), events: [] })
      continue
    }
    // 2002 : LinkedIn : Google —— 冒号分隔，首段是时间点
    const parts = line.split(':').map(p => p.trim()).filter(Boolean)
    if (parts.length === 0) continue
    if (parts.length === 1) {
      currentSection().events.push({ time: parts[0], items: [] })
      continue
    }
    currentSection().events.push({ time: parts[0], items: parts.slice(1) })
  }

  const events = sections.flatMap(s => s.events)
  if (events.length === 0) throw new Error('no timeline events parsed')
  return { kind: 'timeline', title, sections, source: String(source || '').trim() }
}

// ============= 统一入口 =============

/**
 * 解析任意受支持的 mermaid 方言。
 * 不认识的方言 / 解析失败一律返回 null（调用方降级为代码块）。
 */
export function parseMermaidDiagram(source: string): ParsedMermaid | null {
  const type = detectMermaidType(source)
  try {
    switch (type) {
      case 'flowchart':
        if (!isMermaidFlowchart(source)) return null
        return { kind: 'flow', dialect: 'flowchart', diagram: parseMermaidFlowchart(source) }
      case 'state':
        if (!isStateDiagram(source)) return null
        return { kind: 'flow', dialect: 'state', diagram: parseStateDiagram(source) }
      case 'class':
        if (!isClassDiagram(source)) return null
        return { kind: 'flow', dialect: 'class', diagram: parseClassDiagram(source) }
      case 'mindmap':
        if (!isMindmap(source)) return null
        return { kind: 'flow', dialect: 'mindmap', diagram: parseMindmap(source) }
      case 'sequence':
        return parseSequenceDiagram(source)
      case 'pie':
        return parsePieChart(source)
      case 'gantt':
        return parseGanttDiagram(source)
      case 'timeline':
        return parseTimelineDiagram(source)
      default:
        return null
    }
  } catch {
    return null
  }
}

/** 便捷判定：这段源码能不能被我们画出来 */
export function isSupportedMermaid(source: string): boolean {
  return parseMermaidDiagram(source) !== null
}
