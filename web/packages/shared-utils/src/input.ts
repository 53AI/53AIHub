/**
 * 输入相关工具函数
 */

const ALLOWED_NUMBER_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  '.',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Tab',
] as const

type NumberKey = typeof ALLOWED_NUMBER_KEYS[number]

/**
 * 数字输入框键盘事件处理器
 * 阻止非数字字符输入
 */
export function numberInputKeydownHandler(e: KeyboardEvent): void {
  // 允许快捷键组合 (Ctrl/Cmd + A/V/C/X)
  if (e.ctrlKey || e.metaKey) {
    return
  }

  if (!ALLOWED_NUMBER_KEYS.includes(e.key as NumberKey)) {
    e.preventDefault()
    e.stopPropagation()
  }
}

/**
 * 限制输入框只能输入数字
 * @param input HTMLInputElement 或 HTMLTextAreaElement
 */
export function restrictToNumberInput(input: HTMLInputElement | HTMLTextAreaElement): void {
  input.addEventListener('keydown', numberInputKeydownHandler as unknown as EventListener)
}

/**
 * 移除数字输入限制
 */
export function removeNumberInputRestrict(input: HTMLInputElement | HTMLTextAreaElement): void {
  input.removeEventListener('keydown', numberInputKeydownHandler as unknown as EventListener)
}
