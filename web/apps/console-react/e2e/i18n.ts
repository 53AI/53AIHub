/**
 * E2E 测试语言包
 * 直接解析 source.csv 获取文案，避免依赖 Vite 特性
 */

import { readFileSync } from 'fs'
import { join } from 'path'

// 解析 CSV 行
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

// 解析 CSV 文件
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter((line) => line.trim())
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    rows.push(row)
  }

  return rows
}

// 获取中文语言包
export function getZhMessages(): Record<string, string> {
  const csvPath = join(__dirname, '../src/locales/source.csv')
  const content = readFileSync(csvPath, 'utf-8')
  const rows = parseCSV(content)

  const messages: Record<string, string> = {}
  rows.forEach((row) => {
    if (row.key && row['zh-cn']) {
      messages[row.key] = row['zh-cn']
    }
  })

  return messages
}
