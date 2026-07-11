/**
 * 解析 CSV（表头 key, zh-cn, zh-tw, en, ja）并转换为 vue-i18n messages 结构。
 * 用于直接引用 source.csv，不再依赖 4 个 JSON 文件。
 * console、front 等多语言应用共用。
 */

const LANG_COLS = ['zh-cn', 'zh-tw', 'en', 'ja'] as const

/** 按 dot 路径设置嵌套对象上的值 */
function setByPath(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.')
  const last = parts.pop()!
  let cur: Record<string, unknown> = obj
  for (const p of parts) {
    if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[last] = value
}

/**
 * 解析 RFC 4180 风格 CSV（支持引号内逗号、换行、"" 转义）
 */
export function parseCSV(csvRaw: string): string[][] {
  const text = csvRaw.replace(/^\uFEFF/, '') // 去掉 BOM
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuoted = false
        }
      } else {
        cell += c
      }
      continue
    }
    if (c === '"') {
      inQuoted = true
      continue
    }
    if (c === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
      continue
    }
    cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/**
 * 将 CSV 行数据转为 { 'zh-cn': {...}, 'zh-tw': {...}, en: {...}, ja: {...} }
 * 第一行视为表头，需包含 key, zh-cn, zh-tw, en, ja
 */
export function csvToMessages(rows: string[][]): Record<string, Record<string, unknown>> {
  if (rows.length === 0) {
    return { 'zh-cn': {}, 'zh-tw': {}, en: {}, ja: {} }
  }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const keyIdx = header.indexOf('key')
  const langIndices = LANG_COLS.map((lang) => header.indexOf(lang))
  if (keyIdx === -1 || langIndices.some((i) => i === -1)) {
    throw new Error('CSV 表头需包含: key, zh-cn, zh-tw, en, ja')
  }

  const messages: Record<string, Record<string, unknown>> = {
    'zh-cn': {},
    'zh-tw': {},
    en: {},
    ja: {},
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const key = (row[keyIdx] ?? '').trim()
    if (!key) continue
    LANG_COLS.forEach((lang, i) => {
      const val = (row[langIndices[i]] ?? '').trim()
      setByPath(messages[lang], key, val)
    })
  }

  return messages
}
