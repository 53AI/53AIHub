/**
 * 共享组件包默认多语言文案，由各应用在初始化 i18n 时 merge 进自己的 locale。
 * 使用方式：i18n.global.mergeLocaleMessage('zh-cn', sharedComponentsLocales['zh-cn'])
 * 组件内使用：$t('shared_components.table_footer_text', { total })
 */

import zhCN from './zh-cn.json'
import zhTW from './zh-tw.json'
import en from './en.json'
import ja from './ja.json'

export const sharedComponentsLocales = {
  'zh-cn': zhCN,
  'zh-tw': zhTW,
  en,
  ja,
} as const

export type SharedComponentsLocaleKey = keyof typeof sharedComponentsLocales
