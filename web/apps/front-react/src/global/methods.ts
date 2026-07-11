/**
 * 全局方法配置
 * 设置挂载到 window 对象的全局方法
 */

// 允许的键盘按键
const ALLOWED_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '.',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
] as const

type Key = (typeof ALLOWED_KEYS)[number]

const methods = {
  $noop: () => {},
  $getRealPath: ({ url = '' }: { url?: string }) => url || '',
  $getPublicPath: (url = '') => url || '',
  $numberInputKeydownHandler: (e: KeyboardEvent) => {
    if (!ALLOWED_KEYS.includes(e.key as Key)) {
      e.preventDefault()
      e.stopPropagation()
    }
  },
} as const

// 定义全局方法类型
export type GlobalMethods = typeof methods

/**
 * 设置全局方法到 window 对象
 */
export function setupGlobalMethods() {
  Object.assign(window, methods)
}

// 扩展 Window 接口
declare global {
  interface Window extends GlobalMethods {}
}
