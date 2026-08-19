/**
 * 图结构类 Mermaid 方言 → MermaidFlowDiagram
 *
 * stateDiagram / classDiagram / mindmap 本质都是"节点 + 有向边"，
 * 与 flowchart 同构。这里把它们归一化成 MermaidFlowDiagram，
 * 直接复用 MermaidFlowRenderer 的排版与配色，避免重复造渲染器。
 */
import type {
  MermaidFlowDiagram,
  MermaidFlowEdge,
  MermaidFlowNode,
} from '@/api/modules/recording/types'
import { splitNodeLabel } from './mermaidFlowchartParser'

interface DraftNode {
  id: string
  title: string
  content: string
  tone: MermaidFlowNode['tone']
}

/**
 * 节点 id 片段：
 *  - 允许中日韩文字——模型经常直接把中文状态名/类名当 id 用
 *  - 连字符必须后接字符（`A-B` 合法，`待处理-->x` 里的尾部 `-` 不会被吞进 id）
 */
const ID = '[A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff]*(?:-[\\w\\u4e00-\\u9fff]+)*'

// ============= 公共构建工具 =============

class GraphBuilder {
  private nodes = new Map<string, DraftNode>()
  private edges: MermaidFlowEdge[] = []
  private edgeKeys = new Set<string>()

  node(id: string, title?: string, tone: MermaidFlowNode['tone'] = 'neutral'): DraftNode {
    const existing = this.nodes.get(id)
    if (existing) {
      if (title && existing.title === existing.id) existing.title = title
      if (tone !== 'neutral') existing.tone = tone
      return existing
    }
    const created: DraftNode = { id, title: title || id, content: '', tone }
    this.nodes.set(id, created)
    return created
  }

  appendContent(id: string, line: string): void {
    if (!line) return
    const node = this.node(id)
    node.content = node.content ? `${node.content}\n${line}` : line
  }

  edge(from: string, to: string, label = ''): void {
    if (!from || !to || from === to) return
    const key = `${from}\u0000${to}\u0000${label}`
    if (this.edgeKeys.has(key)) return
    this.edgeKeys.add(key)
    this.node(from)
    this.node(to)
    this.edges.push({ from, to, label })
  }

  get size(): number {
    return this.nodes.size
  }

  /** rank = 最长入路径（Kahn 拓扑），与 flowchart 解析器保持一致 */
  build(direction: 'TB' | 'LR'): MermaidFlowDiagram {
    const rank = new Map<string, number>()
    const indegree = new Map<string, number>()
    const outgoing = new Map<string, string[]>()
    for (const id of this.nodes.keys()) {
      rank.set(id, 0)
      indegree.set(id, 0)
      outgoing.set(id, [])
    }
    for (const e of this.edges) {
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
    const nodes: MermaidFlowNode[] = Array.from(this.nodes.values()).map(n => ({
      id: n.id,
      title: n.title,
      content: n.content,
      tone: n.tone,
      rank: rank.get(n.id) ?? 0,
    }))
    return {
      direction,
      nodes,
      edges: this.edges,
    }
  }
}

function normalizeLines(source: string): string[] {
  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.replace(/%%.*$/, ''))
}

function readDirection(line: string, fallback: 'TB' | 'LR'): 'TB' | 'LR' {
  const m = line.match(/^direction\s+(TB|TD|BT|LR|RL)\s*$/i)
  if (!m) return fallback
  const raw = m[1].toUpperCase()
  return raw === 'LR' || raw === 'RL' ? 'LR' : 'TB'
}

// ============= stateDiagram =============

const STATE_HEADER_RE = /^\s*stateDiagram(?:-v2)?\s*$/i
/** [*] 起止伪状态在渲染层用固定 id 表达 */
const STATE_START = '__start__'
const STATE_END = '__end__'
const STATE_NOTE_RE = new RegExp(`^note\\s+(?:(?:left|right)\\s+of|over)\\s+(${ID})\\s*:\\s*(.+)$`, 'i')
const STATE_ALIAS_RE = new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${ID})\\s*\\{?$`, 'i')
const STATE_DECL_RE = new RegExp(`^state\\s+(${ID})\\s*\\{?$`, 'i')
const STATE_TRANSITION_RE = new RegExp(`^(\\[\\*\\]|${ID})\\s*-->\\s*(\\[\\*\\]|${ID})\\s*(?::\\s*(.*))?$`)
const STATE_DESCRIBE_RE = new RegExp(`^(${ID})\\s*:\\s*(.+)$`)
const STATE_BARE_RE = new RegExp(`^(${ID})$`)

export function isStateDiagram(source: string): boolean {
  return normalizeLines(source).some(l => STATE_HEADER_RE.test(l))
}

/**
 * stateDiagram / stateDiagram-v2 → MermaidFlowDiagram
 *
 * 支持：[*] 起止、A --> B : label、state "描述" as id、
 *       composite state（state X { ... } 拍平成普通节点）、direction。
 */
export function parseStateDiagram(source: string): MermaidFlowDiagram {
  const lines = normalizeLines(source)
  const headerIndex = lines.findIndex(l => STATE_HEADER_RE.test(l))
  if (headerIndex < 0) throw new Error('not a stateDiagram')

  const g = new GraphBuilder()
  let direction: 'TB' | 'LR' = 'TB'

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim().replace(/;+$/, '')
    if (!line || line === '}' || line.startsWith('```')) continue
    direction = readDirection(line, direction)
    if (/^direction\s+/i.test(line)) continue
    // note right of A : text —— 备注挂到节点内容上
    const note = line.match(STATE_NOTE_RE)
    if (note) {
      g.appendContent(note[1], note[2].trim())
      continue
    }
    if (/^(?:note|end\s+note)\b/i.test(line)) continue
    // state "长描述" as id / state id { （composite 开头）
    const stateAlias = line.match(STATE_ALIAS_RE)
    if (stateAlias) {
      g.node(stateAlias[2], stateAlias[1].trim())
      continue
    }
    const stateDecl = line.match(STATE_DECL_RE)
    if (stateDecl) {
      g.node(stateDecl[1])
      continue
    }
    // 转移：A --> B : label（[*] 会被替换成起止伪节点）
    const transition = line.match(STATE_TRANSITION_RE)
    if (transition) {
      const from = transition[1] === '[*]' ? STATE_START : transition[1]
      const to = transition[2] === '[*]' ? STATE_END : transition[2]
      if (from === STATE_START) g.node(STATE_START, '开始', 'positive')
      if (to === STATE_END) g.node(STATE_END, '结束', 'critical')
      g.edge(from, to, (transition[3] || '').trim())
      continue
    }
    // A : 描述
    const describe = line.match(STATE_DESCRIBE_RE)
    if (describe) {
      g.appendContent(describe[1], describe[2].trim())
      continue
    }
    const bare = line.match(STATE_BARE_RE)
    if (bare) g.node(bare[1])
  }

  if (g.size === 0) throw new Error('no states parsed')
  return g.build(direction)
}

// ============= classDiagram =============

const CLASS_HEADER_RE = /^\s*classDiagram(?:-v2)?\s*$/i
/** 类名允许泛型标记 ~T~ 与中文 */
const CLASS_ID = '[A-Za-z_\\u4e00-\\u9fff][\\w\\u4e00-\\u9fff~]*'
/** 关系符：长的排前面，避免 `--` 抢先匹配 `-->` */
const CLASS_REL_RE = new RegExp(
  `^(${CLASS_ID})\\s*(<\\|\\.\\.|<\\|--|\\.\\.\\|>|--\\|>|\\*--|--\\*|o--|--o|<\\.\\.|\\.\\.>|<--|-->|\\.\\.|--)\\s*(${CLASS_ID})\\s*(?::\\s*(.*))?$`,
)
const CLASS_DECL_RE = new RegExp(`^class\\s+(${CLASS_ID})\\s*(\\{)?$`, 'i')
const CLASS_MEMBER_RE = new RegExp(`^(${CLASS_ID})\\s*:\\s*(.+)$`)

export function isClassDiagram(source: string): boolean {
  return normalizeLines(source).some(l => CLASS_HEADER_RE.test(l))
}

/**
 * classDiagram → MermaidFlowDiagram
 *
 * 类名当节点，成员（属性/方法）写进 content，继承/组合/关联当边。
 * 箭头朝左的关系（<|--、<--、<..）反向建边，保证箭头语义一致。
 */
export function parseClassDiagram(source: string): MermaidFlowDiagram {
  const lines = normalizeLines(source)
  const headerIndex = lines.findIndex(l => CLASS_HEADER_RE.test(l))
  if (headerIndex < 0) throw new Error('not a classDiagram')

  const g = new GraphBuilder()
  let direction: 'TB' | 'LR' = 'TB'
  let openClass = ''

  for (let i = headerIndex + 1; i < lines.length; i++) {
    // 去掉基数标注 "1" / "0..*"，它们会干扰关系解析
    const line = lines[i].trim().replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim()
    if (!line || line.startsWith('```')) continue
    if (line === '}') {
      openClass = ''
      continue
    }
    direction = readDirection(line, direction)
    if (/^direction\s+/i.test(line)) continue
    if (/^(?:note|<<|click|style|cssClass)\b/i.test(line)) continue

    // class Foo { / class Foo["别名"]
    const classDecl = line.match(CLASS_DECL_RE)
    if (classDecl) {
      g.node(classDecl[1])
      if (classDecl[2]) openClass = classDecl[1]
      continue
    }
    // 类体内的成员行
    if (openClass && !CLASS_REL_RE.test(line)) {
      if (!/^<<.*>>$/.test(line)) g.appendContent(openClass, line)
      continue
    }
    const rel = line.match(CLASS_REL_RE)
    if (rel) {
      const [, left, connector, right, label] = rel
      const reversed = connector.startsWith('<')
      g.node(left)
      g.node(right)
      g.edge(reversed ? right : left, reversed ? left : right, (label || '').trim())
      continue
    }
    // Foo : +int age
    const member = line.match(CLASS_MEMBER_RE)
    if (member) {
      g.appendContent(member[1], member[2].trim())
      continue
    }
  }

  if (g.size === 0) throw new Error('no classes parsed')
  return g.build(direction)
}

// ============= mindmap =============

const MINDMAP_HEADER_RE = /^\s*mindmap\s*$/i
/** mindmap 的各种节点外形；捕获组即内部文本 */
const MINDMAP_SHAPES: Array<[RegExp, number]> = [
  [/^\(\((.*)\)\)$/, 1],
  [/^\)\)(.*)\(\($/, 1],
  [/^\{\{(.*)\}\}$/, 1],
  [/^\[(.*)\]$/, 1],
  [/^\((.*)\)$/, 1],
]

export function isMindmap(source: string): boolean {
  return normalizeLines(source).some(l => MINDMAP_HEADER_RE.test(l))
}

/** 剥掉 mindmap 节点外形与前缀 id，取出展示文本 */
function mindmapText(raw: string): string {
  let text = raw.trim()
  // id((文本)) 形式：前缀 id 只是锚点，不展示
  const prefixed = text.match(/^([A-Za-z_][\w-]*)\s*([([{)].*)$/)
  if (prefixed) text = prefixed[2]
  for (const [re, group] of MINDMAP_SHAPES) {
    const m = text.match(re)
    if (m) return m[group].trim()
  }
  return text
}

/**
 * mindmap → MermaidFlowDiagram（LR 方向，父子边）
 *
 * 层级完全由缩进决定：缩进更深 = 上一个更浅节点的子节点。
 * Tab 记 2 空格，兼容混排缩进。
 */
export function parseMindmap(source: string): MermaidFlowDiagram {
  const lines = normalizeLines(source)
  const headerIndex = lines.findIndex(l => MINDMAP_HEADER_RE.test(l))
  if (headerIndex < 0) throw new Error('not a mindmap')

  const g = new GraphBuilder()
  const stack: Array<{ indent: number; id: string }> = []
  let seq = 0

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, '  ')
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('```')) continue
    // ::icon(fa fa-book) / :::className 是装饰语法，忽略
    if (/^::/.test(trimmed)) continue

    const indent = raw.length - raw.trimStart().length
    const text = mindmapText(trimmed.replace(/:::\s*[A-Za-z_][\w-]*$/, ''))
    if (!text) continue

    const id = `m${seq++}`
    const { title, content } = splitNodeLabel(text)
    const node = g.node(id, title || text)
    node.content = content

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) g.edge(parent.id, id)
    stack.push({ indent, id })
  }

  if (g.size === 0) throw new Error('no mindmap nodes parsed')
  return g.build('LR')
}
