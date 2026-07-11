import type { SkillFileItem } from '@/api/modules/skill/types'
import { isKKFileViewSupported } from '@km/shared-utils'

/** 编辑器类型 */
export type EditorType = 'codemirror' | 'kkfileview' | 'unsupported'

/** 编辑器配置 */
export interface EditorConfig {
  type: EditorType
  language?: string
  editable: boolean
}

/** 从文件名获取扩展名 */
function getFileExtension(filename: string): string {
  if (!filename) return ''
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) return ''
  return filename.slice(lastDotIndex + 1).toLowerCase()
}

/** 可编辑的文件扩展名（支持语法高亮） */
const EDITABLE_EXTENSIONS: Record<string, string> = {
  // 文本和数据格式
  txt: 'text',
  csv: 'text',
  json: 'json',
  xml: 'xml',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'properties',
  toml: 'toml',
  log: 'text',
  cfg: 'properties',
  conf: 'properties',
  rss: 'xml',

  // Web 和脚本
  html: 'html',
  htm: 'html',
  js: 'javascript',
  ts: 'typescript',
  sh: 'shell',
  bat: 'batchfile',
  ps1: 'powershell',

  // 编程语言
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  go: 'go',
  rs: 'rust',
  php: 'php',
  sql: 'sql',
}

/** 默认编辑器配置 */
const DEFAULT_CONFIG: EditorConfig = {
  type: 'unsupported',
  editable: false,
}

/** 获取文件的编辑器配置 */
export function getEditorConfig(file: SkillFileItem | null): EditorConfig {
  if (!file) return DEFAULT_CONFIG

  const name = file.name?.toUpperCase()
  if (name === 'LICENSE' || name?.startsWith('LICENSE.')) {
    return { type: 'codemirror', language: 'text', editable: true }
  }

  const ext = getFileExtension(file.name)

  // 判断是否为可编辑文件
  if (ext in EDITABLE_EXTENSIONS) {
    return {
      type: 'codemirror',
      language: EDITABLE_EXTENSIONS[ext],
      editable: true,
    }
  }

  // 判断是否为 KKFileView 支持的文件类型
  if (isKKFileViewSupported(ext)) {
    return { type: 'kkfileview', editable: false }
  }

  return { type: 'unsupported', editable: false }
}

/** 判断文件是否可编辑 */
export function isFileEditable(file: SkillFileItem | null): boolean {
  return getEditorConfig(file).editable
}

/** 获取 CodeMirror 语言标识 */
export function getCodeMirrorLanguage(file: SkillFileItem | null): string {
  const config = getEditorConfig(file)
  return config.language || 'text'
}
