import { parseCSV, csvToMessages } from '@km/shared-utils'
import { agentCreateMessages } from '@km/shared-business/agent-create'
import { chatMessages } from '@km/shared-business/chat'
import { dataPipelineMessages } from '@km/shared-business/knowledge-pipeline'

// 直接复用 console 的 CSV 源，保证 key 与文案完全一致
// eslint-disable-next-line import/no-relative-packages
import csvRaw from './source.csv?raw'

export type Locale = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

const localeMessages = csvToMessages(parseCSV(csvRaw))

/** 深度合并多个对象，支持任意数量的 source */
function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Record<string, unknown>[]): T {
  let result = { ...target } as T
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (key in result && typeof result[key] === 'object' && typeof source[key] === 'object') {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        ) as T[Extract<keyof T, string>]
      } else {
        (result as Record<string, unknown>)[key] = source[key]
      }
    }
  }
  return result
}

const messages = {
  'zh-cn': deepMerge(
    {},
    agentCreateMessages['zh-cn'],
    chatMessages['zh-cn'],
    dataPipelineMessages['zh-cn'],
    localeMessages['zh-cn']
  ),
  'zh-tw': deepMerge(
    {},
    agentCreateMessages['zh-tw'],
    chatMessages['zh-tw'],
    dataPipelineMessages['zh-tw'],
    localeMessages['zh-tw']
  ),
  en: deepMerge(
    {},
    agentCreateMessages.en,
    chatMessages.en,
    dataPipelineMessages.en,
    localeMessages.en
  ),
  ja: deepMerge(
    {},
    agentCreateMessages.ja,
    chatMessages.ja,
    dataPipelineMessages.ja,
    localeMessages.ja
  ),
}

function getCurrentLocale(): string {
  if (typeof window === 'undefined') return 'zh-cn'

  const stored = localStorage.getItem('default_lang')
  if (stored) {
    // 兼容 'jp' -> 'ja' 映射
    if (stored === 'jp') return 'ja'
      return stored
  }

  const browserLang = navigator.language.toLowerCase()
  const isEn = /^en\b/.test(browserLang)
  const isJa = /^ja\b/.test(browserLang)
  const isTw = /^tw\b/.test(browserLang)
  return isJa ? 'ja' : isEn ? 'en' : isTw ? 'zh-tw' : 'zh-cn'
}

function getByPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj) return undefined
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

function formatWithParams(text: string, params?: Record<string, unknown>): string {
  if (!params) return text
  return Object.keys(params).reduce((acc, key) => {
    const re = new RegExp(`\\{${key}\\}`, 'g')
    return acc.replace(re, String(params[key]))
  }, text)
}

const SHARED_PREFIX = '_shared.'

export function t(key: string, params?: Record<string, unknown>): string {
  const locale = getCurrentLocale()
  const bucket = (messages as any)[locale] as Record<string, unknown> | undefined

  // 先尝试 _shared. 前缀（优先使用分包翻译）
  let rawValue = getByPath(bucket, key)

  // 如果找不到，再尝试直接查找 key
  if (rawValue === undefined) {
    rawValue = getByPath(bucket, SHARED_PREFIX + key)
  }

  const raw = (typeof rawValue === 'string' && rawValue) || key
  return formatWithParams(raw, params)
}

export function setLocale(locale: string, reload = true): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('default_lang', locale)
    if (reload) {
      window.location.reload()
    }
  }
}

// 与 console 保持一致：挂到 window.$t，便于非 React 代码直接使用
declare global {
  interface Window {
    $t: (key: string, params?: Record<string, unknown>) => string
  }
}

if (typeof window !== 'undefined') window.$t = t

export { messages }

/** 动态更新翻译（用于 navigation 等需要动态设置名称的场景） */
export function updateMessages(locale: Locale, updates: Record<string, string>) {
  Object.assign(messages[locale], updates)
}

export default {
  t,
  messages,
  updateMessages,
}

