/**
 * 字段名映射辅助函数
 *
 * 后端 decision_pipeline.py 产出的 items 字段约定:
 *   - 列表型 block（risk_list/action_list/verification_list/comparison/flow_diagram/timeline）
 *     的 items[] 元素使用 {title, content}
 *
 * 前端 markdownParser.ts 解析 markdown 时的 items[] 元素约定:
 *   - flow_diagram: {label, description}
 *   - timeline: {date, event/content/description}
 *   - comparison: {label, content, items}
 *
 * 渲染层要兼容两种来源，所以这里把"任意形态"统一映射成
 * `{title, content}`，让下游 switch case 不必关心来源差异。
 */

export interface NormalizedItem {
  title: string
  content: string
}

/**
 * 兼容多种字段名，返回标准 {title, content}。
 *
 * 接受的别名：
 *   - title  ← label / headline / name / event / question
 *   - content ← description / text / body / summary / detail / event / answer / why_needed
 *
 * 空串 / 缺失字段返回空串，不抛错。
 */
export function normalizeItem(raw: any): NormalizedItem {
  if (!raw || typeof raw !== 'object') return { title: '', content: '' }
  const title =
    (typeof raw.title === 'string' && raw.title) ||
    (typeof raw.label === 'string' && raw.label) ||
    (typeof raw.headline === 'string' && raw.headline) ||
    (typeof raw.name === 'string' && raw.name) ||
    (typeof raw.event === 'string' && raw.event) ||
    (typeof raw.question === 'string' && raw.question) ||
    ''
  const content =
    (typeof raw.content === 'string' && raw.content) ||
    (typeof raw.description === 'string' && raw.description) ||
    (typeof raw.text === 'string' && raw.text) ||
    (typeof raw.body === 'string' && raw.body) ||
    (typeof raw.summary === 'string' && raw.summary) ||
    (typeof raw.detail === 'string' && raw.detail) ||
    (typeof raw.why_needed === 'string' && raw.why_needed) ||
    ''
  return { title: title.trim(), content: content.trim() }
}

/** 把一组 item 标准化，并过滤空 item（标题和内容都为空） */
export function normalizeItems(rawItems: any): NormalizedItem[] {
  if (!Array.isArray(rawItems)) return []
  return rawItems
    .map(normalizeItem)
    .filter(item => item.title || item.content)
}

/**
 * 从 data 中读"文本字段"，按候选顺序挑第一个非空值。
 *
 * 用于 block.data 的标题/摘要类字段（eyebrow / label / title / headline
 * / judgment / subtitle 等多种命名）的容错读取。
 */
export function pickField(data: any, ...keys: string[]): string {
  if (!data || typeof data !== 'object') return ''
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}