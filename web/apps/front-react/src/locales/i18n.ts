import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { parseCSV, csvToMessages } from '@km/shared-utils'
import csvRaw from './source.csv?raw'

type Locale = 'zh-cn' | 'zh-tw' | 'en' | 'jp'

const localeMessages = csvToMessages(parseCSV(csvRaw))

const messages: Record<Locale, any> = {
  'zh-cn': localeMessages['zh-cn'] || {},
  'zh-tw': localeMessages['zh-tw'] || {},
  en: localeMessages.en || {},
  jp: localeMessages.ja || {},
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-cn': { translation: messages['zh-cn'] },
      'zh-tw': { translation: messages['zh-tw'] },
      en: { translation: messages.en },
      jp: { translation: messages.jp },
    },
    lng: 'zh-cn',
    fallbackLng: 'zh-cn',
    interpolation: {
      escapeValue: false,
    },
  })

// Register to global for non-React usage
if (typeof window !== 'undefined') {
  (window as any).$t = i18n.t.bind(i18n)
}

export default i18n
