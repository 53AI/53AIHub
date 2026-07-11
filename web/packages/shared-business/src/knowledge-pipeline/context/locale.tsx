import { createContext, useContext, ReactNode, useState, useCallback, useMemo } from 'react'
import { dataPipelineMessages } from '../locales'

export type SupportedLang = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

type Messages = Record<SupportedLang, Record<string, unknown>>

interface PipelineContextValue {
  /** 当前语言 */
  lang: SupportedLang
  /** 设置语言 */
  setLang: (lang: SupportedLang) => void
  /** 翻译函数 */
  t: (key: string) => string
  /** 当前语言的语言包 */
  messages: Record<string, unknown>
  /** 所有语言的语言包 */
  allMessages: Messages
}

const PipelineContext = createContext<PipelineContextValue>({
  lang: 'zh-cn',
  setLang: () => {},
  t: (key: string) => key,
  messages: {},
  allMessages: { 'zh-cn': {}, 'zh-tw': {}, en: {}, ja: {} },
})

export interface PipelineProviderProps {
  /** 初始语言，默认 'zh-cn' */
  lang?: SupportedLang
  /** 自定义语言包，会与默认语言包深度合并 */
  customMessages?: Partial<Messages>
  /** 语言存储 key，用于 localStorage 持久化。不传则不持久化 */
  storageKey?: string
  /** 子组件 */
  children: ReactNode
}

/**
 * 深度合并两个对象
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T> | Record<string, unknown>
): T {
  const result = { ...target } as Record<string, unknown>
  for (const key of Object.keys(source)) {
    const targetVal = result[key]
    const sourceVal = (source as Record<string, unknown>)[key]
    if (
      key in result &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      typeof sourceVal === 'object' &&
      sourceVal !== null
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      )
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal
    }
  }
  return result as T
}

const DEFAULT_MESSAGES = dataPipelineMessages

/**
 * Pipeline 国际化 Provider
 * 支持自定义语言包、语言持久化
 */
export function PipelineProvider({
  lang: initialLang,
  customMessages,
  storageKey,
  children,
}: PipelineProviderProps) {
  // 合并默认语言包和自定义语言包
  const finalMessages = useMemo(() => {
    if (!customMessages) return DEFAULT_MESSAGES
    return deepMerge(DEFAULT_MESSAGES, customMessages) as Messages
  }, [customMessages])

  const [lang, setLangState] = useState<SupportedLang>(() => {
    if (typeof window === 'undefined') return initialLang || 'zh-cn'
    if (!storageKey) return initialLang || 'zh-cn'
    const stored = localStorage.getItem(storageKey) as SupportedLang | null
    return stored || initialLang || 'zh-cn'
  })

  const setLang = useCallback(
    (newLang: SupportedLang) => {
      setLangState(newLang)
      if (typeof window !== 'undefined' && storageKey) {
        localStorage.setItem(storageKey, newLang)
      }
    },
    [storageKey]
  )

  const currentMessages = useMemo(
    () => finalMessages[lang] || finalMessages['zh-cn'] || {},
    [lang, finalMessages]
  )

  const t = useCallback(
    (key: string): string => {
      // 自动添加 _shared. 前缀（与 buildMessages 生成的结构一致）
      // messages 结构: { "_shared": { "data_pipeline": { ... } } }
      key = key || ''
      const fullKey = key.startsWith('_') ? key : `_shared.${key}`
      const parts = fullKey.split('.')
      let result: unknown = currentMessages
      for (const part of parts) {
        if (result && typeof result === 'object' && part in (result as Record<string, unknown>)) {
          result = (result as Record<string, unknown>)[part]
        } else {
          return key
        }
      }
      return typeof result === 'string' ? result : key
    },
    [currentMessages]
  )

  const value = useMemo(
    () => ({ lang, setLang, t, messages: currentMessages, allMessages: finalMessages }),
    [lang, setLang, t, currentMessages, finalMessages]
  )

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>
}

/**
 * 获取 Pipeline 上下文
 */
export function usePipeline() {
  return useContext(PipelineContext)
}

/**
 * 获取翻译函数
 */
export function usePipelineTranslation() {
  const { t } = usePipeline()
  return { t }
}
