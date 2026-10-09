/**
 * Agent Plugin 应用级 i18n
 *
 * - tApp(key)：纯函数翻译，供非 React 模块（stores / utils / adapters）
 *   以及 ChatConfigProvider 之外的组件（App 启动/错误态）使用。
 *   语言读取 localStorage（与 shared-business ChatConfigProvider 共用
 *   同一存储 key，语言切换后自动同步）> 浏览器语言 > zh-cn。
 * - useAppTranslation()：响应式 hook，供 ChatConfigProvider 内的组件使用，
 *   复用 chat 上下文的 lang，语言切换时自动重渲染。
 */
import { useCallback } from 'react'
import { useTranslation } from '@km/shared-business/chat'
import { appMessages, type Lang } from './locales'

export type { Lang }

/** 与 ChatConfigProvider（shared-business/chat/i18n）共用的语言存储 key */
const LANG_KEY = 'agentplugin-lang'

function detectBrowserLanguage(): Lang {
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('zh-tw') || browserLang.startsWith('zh-hant')) {
    return 'zh-tw'
  }
  if (browserLang.startsWith('zh')) {
    return 'zh-cn'
  }
  if (browserLang.startsWith('ja')) {
    return 'ja'
  }
  if (browserLang.startsWith('en')) {
    return 'en'
  }
  return 'zh-cn'
}

/** 当前语言：localStorage（与 ChatConfigProvider 共用）> 浏览器语言 > zh-cn */
export function getCurrentLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null
    if (stored && stored in appMessages) return stored
  } catch {
    // localStorage 不可用时忽略
  }
  return detectBrowserLanguage()
}

function translateForLang(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>
): string {
  const messages = appMessages[lang] || appMessages['zh-cn']
  let text = messages[key]
  // 回退 zh-cn，最终回退 key 本身
  if (text === undefined) text = appMessages['zh-cn'][key]
  if (text === undefined) return key

  // 插值 {{param}}（与 chat t() 行为一致）
  if (params) {
    text = text.replace(/\{\{(\w+)\}\}/g, (_, paramKey) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : `{{${paramKey}}}`
    })
  }
  return text
}

/**
 * 应用级翻译（非 React 模块用）
 * React 组件（ChatConfigProvider 内）请使用 useAppTranslation 以获得语言切换响应。
 */
export function tApp(key: string, params?: Record<string, string | number>): string {
  return translateForLang(getCurrentLang(), key, params)
}

/**
 * 应用级翻译 hook（需在 ChatConfigProvider 内使用）
 * 复用 chat 上下文的 lang，语言切换时自动重渲染。
 */
export function useAppTranslation() {
  const { lang } = useTranslation()
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translateForLang(lang, key, params),
    [lang]
  )
  return { lang, t }
}
