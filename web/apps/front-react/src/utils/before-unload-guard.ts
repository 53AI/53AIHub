/**
 * BeforeUnload Guard
 * 用于管理页面的 beforeunload 保护状态
 * 当页面有编辑等需要保护的状态时，设置全局标记
 * 录音的 beforeunload 会检测此标记，避免重复提示
 */

let counter = 0

/**
 * 启用 beforeunload 保护标记
 * 在添加 beforeunload 事件监听时调用
 * @returns 清理函数，在移除监听时调用
 */
export function enableBeforeUnloadProtection(): () => void {
  counter++
  ;(window as any).__hasBeforeUnloadProtection__ = true

  return () => {
    counter--
    if (counter <= 0) {
      counter = 0
      ;(window as any).__hasBeforeUnloadProtection__ = false
    }
  }
}

/**
 * 检查是否有 beforeunload 保护
 */
export function hasBeforeUnloadProtection(): boolean {
  return !!(window as any).__hasBeforeUnloadProtection__
}

/**
 * 自定义 hook：在条件满足时注册 beforeunload 保护
 * 自动管理全局标记，其他地方不需要单独调用 enableBeforeUnloadProtection
 *
 * @example
 * // 基础用法 - 有未保存更改时显示提示
 * useBeforeUnloadGuard(hasUnsavedChanges)
 *
 * @example
 * // 自定义提示信息
 * useBeforeUnloadGuard(hasUnsavedChanges, '有未保存的内容，确定要离开吗？')
 */
import { useEffect, useRef } from 'react'

export function useBeforeUnloadGuard(
  enabled: boolean | (() => boolean),
  message: string = ''
) {
  const handlerRef = useRef<((event: BeforeUnloadEvent) => void) | null>(null)

  useEffect(() => {
    const shouldPrevent = typeof enabled === 'function' ? enabled() : enabled
    if (!shouldPrevent) return

    // 启用保护标记
    const disableProtection = enableBeforeUnloadProtection()

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      if (message) {
        event.returnValue = message
      } else {
        event.returnValue = ''
      }
    }

    handlerRef.current = handleBeforeUnload
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      disableProtection()
    }
  }, [enabled, message])
}

export default useBeforeUnloadGuard
