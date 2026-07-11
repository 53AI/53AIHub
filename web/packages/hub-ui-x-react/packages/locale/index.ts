import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhLocale from './zh-cn';
import zhTwLocale from './zh-tw';
import enLocale from './en';
import jpLocale from './jp';

const resources = {
  'zh-cn': {
    translation: zhLocale,
  },
  'zh-tw': {
    translation: zhTwLocale,
  },
  'en': {
    translation: enLocale,
  },
  'ja': {
    translation: jpLocale,
  },
};

function getInitialLocale(): string {
  if (typeof window === 'undefined') return 'zh-cn';
  const stored = localStorage.getItem('default_lang');
  if (stored) return stored;
  const browserLang = navigator.language.toLowerCase();
  if (/^en\b/.test(browserLang)) return 'en';
  if (/^ja\b/.test(browserLang)) return 'ja';
  if (/^tw\b/.test(browserLang)) return 'zh-tw';
  return 'zh-cn';
}

// 当前语言
let currentLocale = getInitialLocale();

// 直接翻译函数
function translate(key: string): string {
  const localeKey = currentLocale as keyof typeof resources;
  const translations = resources[localeKey]?.translation || resources['zh-cn'].translation;

  // 解析 key，如 "hubx.bubble.fullscreen"
  const keys = key.split('.');
  let result: any = translations;

  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = result[k];
    } else {
      return key; // 找不到翻译，返回 key
    }
  }

  return typeof result === 'string' ? result : key;
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: currentLocale,
    fallbackLng: 'zh-cn',
    interpolation: {
      escapeValue: false,
    },
  });

export function changeHubxLanguage(locale: string) {
  currentLocale = locale;
  i18n.changeLanguage(locale);
}

// 导出 t 函数，供组件使用
export const t = (key: string, options?: any): string => {
  return translate(key);
};

export default i18n;
