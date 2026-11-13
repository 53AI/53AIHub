/**
 * 入口模板（Vite MPA 多页入口）。
 *
 * 每个模板 HTML 在 <head> 内联脚本中声明 window.__APP_TEMPLATE__，
 * 必须在 module 脚本（/src/main.tsx）加载前执行。
 *
 * - main:     index.html，默认入口，风格跟随企业配置 template_type
 * - website:  website.html，强制网站模式（顶部横向导航）
 * - client:   client.html，强制软件模式（左侧导航）
 * - recording: erhao.html，软件模式且仅展示安心录菜单
 */
export const APP_TEMPLATE = {
  MAIN: 'main',
  WEBSITE: 'website',
  CLIENT: 'client',
  RECORDING: 'recording'
} as const

export type AppTemplate = (typeof APP_TEMPLATE)[keyof typeof APP_TEMPLATE]

const TEMPLATE_VALUES: string[] = Object.values(APP_TEMPLATE)

/** 读取当前入口模板，未声明或值非法时按主入口处理 */
export function getAppTemplate(): AppTemplate {
  const value = window.__APP_TEMPLATE__
  return value && TEMPLATE_VALUES.includes(value) ? (value as AppTemplate) : APP_TEMPLATE.MAIN
}

/** 是否为模板入口（非 index.html） */
export function isTemplateEntry(): boolean {
  return getAppTemplate() !== APP_TEMPLATE.MAIN
}

/** 是否为安心录（recording）模板入口：erhao.html，仅展示安心录菜单 */
export function isRecordingEntry(): boolean {
  return getAppTemplate() === APP_TEMPLATE.RECORDING
}

/**
 * 各模板入口的 URL 基础路径。
 * history 路由模式下作为 BrowserRouter 的 basename（URL 形如 /client.html/agent），
 * buildUrl / setRouter 等直接操作地址栏的地方据此拼接前缀；
 * hash 路由模式下入口即 pathname，无需使用。
 */
export const TEMPLATE_ENTRY_BASE: Record<AppTemplate, string> = {
  main: '',
  website: '/website.html',
  client: '/client.html',
  recording: '/erhao.html'
}

/** 当前入口的 URL 基础路径（主入口为空串） */
export function getEntryBase(): string {
  return TEMPLATE_ENTRY_BASE[getAppTemplate()]
}
