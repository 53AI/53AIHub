import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * 轮询 Hook
 * @param fn 执行函数
 * @param interval 轮询间隔（毫秒），默认 5000
 */
export function usePoll(fn: () => Promise<any> | void, interval: number = 5000) {
  const [isPolling, setIsPolling] = useState(false)
  const isPollingRef = useRef(false)  // 用 ref 跟踪状态，避免闭包问题
  const isVisibleRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibilityHandlerRef = useRef<(() => void) | null>(null)
  const fnRef = useRef(fn)

  // 更新函数引用
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    isPollingRef.current = false  // 同步更新 ref
    setIsPolling(false)

    if (visibilityHandlerRef.current && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }
  }, [])

  // 执行函数并确保返回 Promise
  const executeFn = useCallback(async () => {
    const result = fnRef.current()
    return result instanceof Promise ? result : Promise.resolve(result)
  }, [])

  const start = useCallback(() => {
    // 防止重复启动
    stop()
    isPollingRef.current = true  // 同步更新 ref
    setIsPolling(true)

    // 初始化可见性状态
    if (typeof document !== 'undefined') {
      isVisibleRef.current = !document.hidden
    }

    // 立即执行一次
    executeFn()

    const run = () => {
      if (!isPollingRef.current) return  // 使用 ref 检查

      // 如果页面隐藏，不执行轮询，但保持轮询状态
      if (!isVisibleRef.current) {
        timerRef.current = setTimeout(() => {
          run()
        }, interval)
        return
      }

      timerRef.current = setTimeout(async () => {
        // 再次检查轮询状态和可见性
        if (!isPollingRef.current || !isVisibleRef.current) {
          run()
          return
        }

        try {
          await executeFn()
          run()
        } catch (error) {
          console.error('Polling error:', error)
          stop()
        }
      }, interval)
    }

    // 添加可见性变化监听器
    if (typeof document !== 'undefined') {
      visibilityHandlerRef.current = () => {
        const wasVisible = isVisibleRef.current
        isVisibleRef.current = !document.hidden

        // 页面从隐藏变为可见时，立即执行一次并继续轮询
        if (!wasVisible && isVisibleRef.current && isPollingRef.current) {
          executeFn()
            .then(() => run())
            .catch((error) => {
              console.error('Polling error:', error)
              stop()
            })
        }
      }

      document.addEventListener('visibilitychange', visibilityHandlerRef.current)
    }

    run()
  }, [interval, stop, executeFn])

  // 组件卸载时自动停止
  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    isPolling,
    start,
    stop
  }
}

export default usePoll
