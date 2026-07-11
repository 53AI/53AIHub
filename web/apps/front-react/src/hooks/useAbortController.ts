import { useEffect, useRef, useCallback } from 'react'

// 全局 AbortController 上下文
let globalAbortController: AbortController | null = null

/**
 * 设置全局 AbortController
 */
export const setGlobalAbortController = (controller: AbortController | null) => {
  globalAbortController = controller
}

/**
 * 获取全局 AbortController 的 signal
 */
export const getGlobalAbortSignal = () => {
  return globalAbortController?.signal
}

/**
 * AbortController 管理 Hook
 * 用于在组件卸载时自动取消未完成的请求
 *
 * @example
 * ```tsx
 * // 在组件中使用（最简单的方式）
 * useAbortController()
 *
 * // 所有 API 调用会自动使用这个 signal（通过 axios 拦截器）
 * // 无需手动传递，拦截器会自动处理
 * await librariesApi.list({ space_id: 'xxx' })
 *
 * // 如果需要手动控制
 * const { create, abort, signal } = useAbortController()
 * create() // 手动创建
 * abort()  // 手动取消
 * ```
 */
export const useAbortController = () => {
  const abortControllerRef = useRef<AbortController | null>(null)

  // 创建新的 AbortController
  const create = useCallback(() => {
    // 如果已存在，先取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    // 同步到全局上下文，供 axios 拦截器使用
    setGlobalAbortController(abortControllerRef.current)
    return abortControllerRef.current
  }, [])

  // 取消所有请求
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      // 清除全局上下文
      setGlobalAbortController(null)
    }
  }, [])

  // 组件挂载时自动创建，卸载时自动取消
  useEffect(() => {
    create()
    return () => {
      abort()
    }
  }, [create, abort])

  return {
    abortController: abortControllerRef.current,
    signal: abortControllerRef.current?.signal,
    create,
    abort
  }
}

export default useAbortController
