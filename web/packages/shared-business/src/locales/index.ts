/**
 * Shared-Business 公共语言包工具
 */

/** 按 dot 路径设置嵌套对象上的值 */
export function setByPath(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.')
  const last = parts.pop()!
  let cur: Record<string, unknown> = obj
  for (const p of parts) {
    if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[last] = value
}

export type FlatMessages = Record<string, string>

/** 扁平消息转嵌套结构 */
export function toNested(flat: FlatMessages): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(flat)) {
    setByPath(obj, key, val)
  }
  return obj
}

/** key 行类型：[key, zh-cn, zh-tw, en, ja] */
export type KeyRow = readonly [string, string, string, string, string]

/** 前缀，避免覆盖主站翻译 */
export const PREFIX = '_shared.'

/** 构建 FlatMessages，自动添加前缀 */
export function buildFlatMessages(rows: readonly KeyRow[], langIndex: number): FlatMessages {
  const result: FlatMessages = {}
  for (const row of rows) {
    result[PREFIX + row[0]] = row[langIndex]
  }
  return result
}

/** 构建 messages 对象 */
export function buildMessages(rows: readonly KeyRow[]) {
  return {
    'zh-cn': toNested(buildFlatMessages(rows, 1)),
    'zh-tw': toNested(buildFlatMessages(rows, 2)),
    en: toNested(buildFlatMessages(rows, 3)),
    ja: toNested(buildFlatMessages(rows, 4)),
  }
}
