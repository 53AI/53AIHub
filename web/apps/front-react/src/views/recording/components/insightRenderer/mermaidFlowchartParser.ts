/**
 * 轻量 Mermaid flowchart 解析器
 *
 * 目标：把 ```mermaid\nflowchart TB / LR ... ``` 源码转成 MermaidFlowDiagram，
 * 供 MermaidFlowRenderer 消费。对齐 meeting-recorder 的 parse_mermaid_flow：
 *
 *   - 头部：flowchart | graph + TB | TD | BT | LR | RL（不区分大小写，可出现在任意行）
 *   - 节点：<id>[...] / (...) / {...} / ([...]) / [(...)] / ((...)) / [[...]]，
 *           可选后缀 :::tone；支持写在连接行内（A[开始] --> B[结束]）
 *   - 标签：`标题 | 正文` 按首个 | 或 ｜ 拆成 title / content；<br> 转换行；
 *           HTML 标签一律剥离（模型输出不可信，不渲染任意 HTML）
 *   - 连接：--> / -.-> / ==>，支持 A --> B --> C、A & B --> C、A -->|label| B、
 *           以及 A -- label --> B
 *   - 样式：classDef 忽略；class A,B tone 只取 tone 名
 *
 * 完全无法解析（非 flowchart 头 / 无节点）时抛出 Error，由调用方降级为代码块。
 */
import type {
  MermaidFlowDiagram,
  MermaidFlowEdge,
  MermaidFlowNode,
} from '@/api/modules/recording/types'

// ============= 类型 =============

type Tone = MermaidFlowNode['tone']

interface RawNode {
  id: string
  title: string
  content: string
  tone: Tone
}

interface RawEdge {
  from: string
  to: string
  label: string
}

/** MermaidFlowRenderer 已经支持的 tone 集合；其它 class 名一律降级为 neutral */
const KNOWN_TONES = new Set<string>([
  'neutral',
  'positive',
  'info',
  'warning',
  'danger',
  'critical',
  'pending',
])

// ============= 正则（模块级 hoist，避免循环内重建） =============

/** 头部：flowchart / graph + 方向。可出现在任意一行（源码可能带前导注释） */
const HEADER_RE = /^\s*(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*;?\s*$/i

/** 连接符：--> / -.-> / ==> */
const CONNECTOR_RE = /\s*(?:-->|-\.->|==>)\s*/
const HAS_CONNECTOR_RE = /-->|-\.->|==>/

/**
 * 节点定义。alternation 顺序即优先级：双层 shape 必须排在单层前面，
 * 否则 `A[[x]]` 会被 `\[[^\]]*\]` 截成 `[[x]`。
 */
const NODE_RE =
  /([A-Za-z_][\w-]*)\s*(\(\[[\s\S]*?\]\)|\[\([\s\S]*?\)\]|\(\([\s\S]*?\)\)|\[\[[\s\S]*?\]\]|\[[^\]]*\]|\([^)]*\)|\{[^}]*\})\s*(?::::\s*([A-Za-z_][\w-]*))?/g

/** 裸 class 引用：A:::info */
const BARE_TONE_RE = /^([A-Za-z_][\w-]*)\s*:::\s*([A-Za-z_][\w-]*)\s*$/
/** class A,B toneName */
const CLASS_ASSIGN_RE = /^class\s+([A-Za-z_][\w-]*(?:\s*[,\s]\s*[A-Za-z_][\w-]*)*)\s+([A-Za-z_][\w-]*)\s*;?$/i
/** 提取合法节点 id（避免匹配 id 的一部分） */
const ID_RE = /(?<![\w-])([A-Za-z_][\w-]*)(?![\w-])/g
/** 段首的 |label| */
const SEGMENT_LABEL_RE = /^\|\s*([^|]*?)\s*\|\s*([\s\S]*)$/
/** A -- label --> B 归一化成 A -->|label| B */
const MID_LABEL_RE = /--\s*([^->|]+?)\s*-->/g
/** 行尾注释 */
const TRAILING_COMMENT_RE = /%%.*$/

const BR_RE = /<\s*br\s*\/?\s*>/gi
const HTML_TAG_RE = /<[^>]+>/g

// ============= 文本处理 =============

/** 去掉 shape 括号，得到裸标签文本 */
function extractShapeText(shape: string): string {
  const s = shape.trim()
  const doubleWrapped =
    (s.startsWith('([') && s.endsWith('])')) ||
    (s.startsWith('[(') && s.endsWith(')]')) ||
    (s.startsWith('((') && s.endsWith('))')) ||
    (s.startsWith('[[') && s.endsWith(']]'))
  return doubleWrapped ? s.slice(2, -2) : s.slice(1, -1)
}

/** 去掉首尾配对的引号（Mermaid 里 "..." 只是转义手段，不是内容） */
function stripQuotes(raw: string): string {
  const s = (raw || '').trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).trim()
  return s
}

/**
 * 把节点标签拆成 title / content：
 *   - <br> → 换行，其余 HTML 标签直接剥离（不信任模型输出的 HTML）
 *   - 首个 `|` 或 `｜` 之前是标题，之后是正文
 *   - 没有 `|` 但有换行时，第一行是标题，其余是正文
 */
export function splitNodeLabel(raw: string): { title: string; content: string } {
  let label = String(raw || '').replace(BR_RE, '\n')
  label = label.replace(HTML_TAG_RE, '')
  label = label
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
  label = stripQuotes(label).replace(/\\"/g, '"').trim()

  const sepIndex = label.search(/[|｜]/)
  if (sepIndex >= 0) {
    const title = label.slice(0, sepIndex).trim()
    const content = label.slice(sepIndex + 1).trim()
    if (title) return { title, content }
    return { title: content, content: '' }
  }
  const nlIndex = label.indexOf('\n')
  if (nlIndex >= 0) {
    return { title: label.slice(0, nlIndex).trim(), content: label.slice(nlIndex + 1).trim() }
  }
  return { title: label, content: '' }
}

function normalizeTone(name: string): Tone {
  const tone = (name || '').toLowerCase()
  return (KNOWN_TONES.has(tone) ? tone : 'neutral') as Tone
}

// ============= 节点登记 =============

interface NodeInput {
  id: string
  title?: string
  content?: string
  tone?: Tone
}

/** 登记节点；已存在时只补齐缺失信息（后出现的具名定义可覆盖占位 title） */
function addNode(nodes: Map<string, RawNode>, input: NodeInput): void {
  const id = input.id.trim()
  if (!id) return
  const existing = nodes.get(id)
  if (!existing) {
    nodes.set(id, {
      id,
      title: input.title || id,
      content: input.content || '',
      tone: input.tone || 'neutral',
    })
    return
  }
  // 占位 title（等于 id）可被真实标签覆盖
  if (input.title && existing.title === existing.id) {
    existing.title = input.title
    existing.content = input.content || ''
  } else if (input.content && !existing.content) {
    existing.content = input.content
  }
  if (input.tone && input.tone !== 'neutral') existing.tone = input.tone
}

/**
 * 抽出行内所有节点定义并登记，返回把 shape 替换成裸 id 后的行。
 * 这样后续的连接解析只需处理 `A --> B` 这种纯 id 形式。
 */
function extractInlineNodes(line: string, nodes: Map<string, RawNode>): string {
  NODE_RE.lastIndex = 0
  return line.replace(NODE_RE, (_full, id: string, shape: string, tone?: string) => {
    const { title, content } = splitNodeLabel(extractShapeText(shape))
    addNode(nodes, { id, title: title || id, content, tone: tone ? normalizeTone(tone) : 'neutral' })
    return id
  })
}

function collectIds(text: string): string[] {
  ID_RE.lastIndex = 0
  return text.match(ID_RE) || []
}

// ============= 连接解析 =============

/** 解析一行连接（含链式、多源、可选 label）。行内已无 shape。 */
function parseEdgeLine(line: string): RawEdge[] {
  const segments = line.split(CONNECTOR_RE)
  if (segments.length < 2) return []

  const edges: RawEdge[] = []
  // 链式规则：上一段的 targets 就是下一段的 sources
  // A --> B --> C：第一轮 [A]→B，第二轮 [B]→C
  let currentSources = collectIds(segments[0])
  for (let i = 1; i < segments.length; i++) {
    let rest = segments[i].trim()
    let label = ''
    const labelMatch = rest.match(SEGMENT_LABEL_RE)
    if (labelMatch) {
      label = labelMatch[1].trim()
      rest = labelMatch[2].trim()
    }
    const targets = collectIds(rest)
    for (const from of currentSources) {
      for (const to of targets) {
        if (from !== to) edges.push({ from, to, label })
      }
    }
    currentSources = targets
  }
  return edges
}

// ============= Rank 计算（Kahn 拓扑排序） =============

/**
 * 层级 rank = 最长入路径长度。用 Kahn 算法：入度为 0 的节点 rank=0，
 * 出队时把后继 rank 抬到 max(自身, 当前+1)。环上的节点入度永远降不到 0，
 * 留在 rank=0，不会死循环。
 */
function computeRanks(nodes: RawNode[], edges: RawEdge[]): Map<string, number> {
  const rank = new Map<string, number>()
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const n of nodes) {
    rank.set(n.id, 0)
    indegree.set(n.id, 0)
    outgoing.set(n.id, [])
  }
  for (const e of edges) {
    if (!rank.has(e.from) || !rank.has(e.to)) continue
    indegree.set(e.to, (indegree.get(e.to) || 0) + 1)
    outgoing.get(e.from)!.push(e.to)
  }

  const queue: string[] = []
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id)
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const target of outgoing.get(current) || []) {
      rank.set(target, Math.max(rank.get(target) || 0, (rank.get(current) || 0) + 1))
      const left = (indegree.get(target) || 0) - 1
      indegree.set(target, left)
      if (left === 0) queue.push(target)
    }
  }
  return rank
}

// ============= 主入口 =============

/** 找出头部所在行号与方向；找不到返回 null */
function findHeader(lines: string[]): { index: number; direction: 'TB' | 'LR' } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER_RE)
    if (!m) continue
    const raw = m[1].toUpperCase()
    return { index: i, direction: raw === 'LR' || raw === 'RL' ? 'LR' : 'TB' }
  }
  return null
}

/**
 * 把 Mermaid flowchart 源码解析为 MermaidFlowDiagram。
 * 解析失败（不支持的语法 / 完全空图）抛 Error。
 */
export function parseMermaidFlowchart(source: string): MermaidFlowDiagram {
  const raw = String(source || '').replace(/\r\n/g, '\n')
  const lines = raw.split('\n')

  const header = findHeader(lines)
  if (!header) {
    const firstMeaningful = lines.find(l => l.trim() && !l.trim().startsWith('%%')) || ''
    if (!firstMeaningful.trim()) throw new Error('empty mermaid source')
    throw new Error(`unsupported mermaid header: ${firstMeaningful.trim()}`)
  }
  const direction = header.direction

  const nodes = new Map<string, RawNode>()
  const edges: RawEdge[] = []
  const edgeKeys = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    if (i === header.index) continue
    let line = lines[i].trim()
    if (!line || line.startsWith('%%') || line.startsWith('```')) continue
    line = line.replace(TRAILING_COMMENT_RE, '').trim()
    if (!line) continue

    const lower = line.toLowerCase()
    // 样式与分组语法：不影响拓扑，直接跳过
    if (
      lower.startsWith('classdef ') ||
      lower.startsWith('style ') ||
      lower.startsWith('linkstyle ') ||
      lower.startsWith('click ') ||
      lower.startsWith('subgraph ') ||
      lower === 'subgraph' ||
      lower === 'end'
    ) {
      continue
    }

    // class A,B toneName → 给节点套 tone（节点不存在时先建占位）
    const classAssign = line.match(CLASS_ASSIGN_RE)
    if (classAssign) {
      const tone = normalizeTone(classAssign[2])
      for (const id of collectIds(classAssign[1])) addNode(nodes, { id, tone })
      continue
    }

    // A:::info（无 shape，仅 class 引用）
    const bareTone = line.match(BARE_TONE_RE)
    if (bareTone) {
      addNode(nodes, { id: bareTone[1], tone: normalizeTone(bareTone[2]) })
      continue
    }

    // 先摘出行内节点定义（连接行也可能带 shape），再解析连接
    const normalized = extractInlineNodes(line.replace(MID_LABEL_RE, '-->|$1|'), nodes)
      .replace(/:::\s*[A-Za-z_][\w-]*/g, '')
      .trim()
    if (!normalized) continue

    if (HAS_CONNECTOR_RE.test(normalized)) {
      for (const edge of parseEdgeLine(normalized)) {
        const key = `${edge.from}\u0000${edge.to}\u0000${edge.label}`
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edges.push(edge)
        addNode(nodes, { id: edge.from })
        addNode(nodes, { id: edge.to })
      }
      continue
    }

    // 剩下的是裸 id 声明（`A` 单独一行）
    for (const id of collectIds(normalized)) addNode(nodes, { id })
  }

  if (nodes.size === 0) throw new Error('no nodes parsed')

  const rawNodes = Array.from(nodes.values())
  const ranks = computeRanks(rawNodes, edges)
  const flowNodes: MermaidFlowNode[] = rawNodes.map(n => ({
    id: n.id,
    title: n.title,
    content: n.content,
    tone: n.tone,
    rank: ranks.get(n.id) ?? 0,
  }))

  const flowEdges: MermaidFlowEdge[] = edges.map(e => ({
    from: e.from,
    to: e.to,
    label: e.label || '',
  }))

  return {
    direction,
    nodes: flowNodes,
    edges: flowEdges,
  }
}

/** 便捷判定：源码是否是 flowchart 语法（其它 mermaid 类型直接放弃） */
export function isMermaidFlowchart(source: string): boolean {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n')
  return findHeader(lines) !== null
}
