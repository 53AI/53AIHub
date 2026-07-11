import { create } from 'zustand'

export type LocaleValue = 'zh-cn' | 'zh-tw' | 'en' | 'ja'

function getInitialLocale(): LocaleValue {
  const browserLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase()
  const isEn = /^en\b/.test(browserLang)
  const isJa = /^ja\b/.test(browserLang)
  const isTw = /^tw\b/.test(browserLang)

  const stored = typeof localStorage !== 'undefined' ? (localStorage.getItem('default_lang') as LocaleValue | null) : null
  return stored || (isJa ? 'ja' : isEn ? 'en' : isTw ? 'zh-tw' : 'zh-cn')
}

interface LocaleState {
  locale: LocaleValue
  setLocale: (v: LocaleValue) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: getInitialLocale(),
  setLocale(v) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('default_lang', v)
    }
    set({ locale: v })
  },
}))

