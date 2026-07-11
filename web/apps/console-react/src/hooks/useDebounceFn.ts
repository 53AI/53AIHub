import { useCallback, useRef } from 'react'

/**
 * 防抖函数 hook
 * @param fn 需要防抖的函数
 * @param delay 延迟时间，默认 1000ms
 * @param immediate 是否立即执行第一次，默认 true
 */
export function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  delay = 1000,
  immediate = true,
): (...args: Parameters<T>) => void {
  const timerRef = useRef<number | null>(null)
  const hasExecutedRef = useRef(false)

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }

      if (immediate && !hasExecutedRef.current) {
        fn(...args)
        hasExecutedRef.current = true
      }

      timerRef.current = window.setTimeout(() => {
        if (!immediate) {
          fn(...args)
        }
        timerRef.current = null
        hasExecutedRef.current = false
      }, delay)
    },
    [fn, delay, immediate],
  )
}

export default useDebounceFn
