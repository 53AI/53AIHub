/**
 * 将多语言 JSON（zh-cn, zh-tw, en, ja）合并为单文件 CSV。
 * 用法: node scripts/json-to-csv.mjs <app>
 * 例: node scripts/json-to-csv.mjs apps/console
 * 会读取 apps/console/src/locales/*.json 并生成 apps/console/src/locales/source.csv
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const LANGS = ['zh-cn', 'zh-tw', 'en', 'ja']
const LANG_FILES = Object.fromEntries(LANGS.map((l) => [l, `${l}.json`]))

/** 扁平化嵌套对象为 dot 路径 */
function flatten(obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else {
      out[key] = v == null ? '' : String(v)
    }
  }
  return out
}

/** CSV 单元格转义：含逗号、换行、双引号时用双引号包裹，内部 " 写为 "" */
function escapeCell(val) {
  const s = String(val ?? '')
  if (/[,"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function main() {
  const app = process.argv[2] || 'apps/console'
  const localeDir = path.join(root, app, 'src', 'locales')
  if (!fs.existsSync(localeDir)) {
    console.error('目录不存在:', localeDir)
    process.exit(1)
  }

  const flat = {}
  for (const lang of LANGS) {
    const file = path.join(localeDir, LANG_FILES[lang])
    if (!fs.existsSync(file)) {
      console.warn('跳过不存在的文件:', file)
      flat[lang] = {}
      continue
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    flat[lang] = flatten(data)
  }

  const allKeys = new Set()
  for (const o of Object.values(flat)) {
    for (const k of Object.keys(o)) allKeys.add(k)
  }
  const keys = Array.from(allKeys).sort()

  const header = ['key', ...LANGS]
  const rows = keys.map((key) => [
    key,
    flat['zh-cn'][key] ?? '',
    flat['zh-tw'][key] ?? '',
    flat['en'][key] ?? '',
    flat['ja'][key] ?? '',
  ])

  const csvLines = [
    header.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ]
  const csv = csvLines.join('\n')
  const outFile = path.join(localeDir, 'source.csv')
  fs.writeFileSync(outFile, '\uFEFF' + csv, 'utf-8') // BOM for Excel
  console.log('已生成:', outFile, '共', keys.length, '条 key')
}

main()
