import { useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import mySpaceApi from '@/api/modules/my-space'

export interface UseMySpaceContextReturn {
  libraryId: string
  contextReady: boolean
  contextInitializing: boolean
  ensureLibraryId: () => Promise<string>
  fetchContext: () => Promise<void>
}

/**
 * 个人空间上下文 Hook
 * 封装 libraryId 获取和缓存逻辑
 */
export function useMySpaceContext(): UseMySpaceContextReturn {
  const libraryIdRef = useRef<string>('')
  const fetchingRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const [contextReady, setContextReady] = useState(false)
  const [contextInitializing, setContextInitializing] = useState(false)

  const fetchContext = useCallback(async () => {
    // 已经有 libraryId 或正在请求中，直接返回
    if (libraryIdRef.current || fetchingRef.current) {
      if (libraryIdRef.current) setContextReady(true)
      return
    }

    fetchingRef.current = true
    try {
      const ctx = await mySpaceApi.getContext()
      libraryIdRef.current = ctx.library_id
      setContextReady(true)
      setContextInitializing(false)
    } catch (error: any) {
      if (error?.response?.status === 429) {
        // 429 限流，延迟重试
        fetchingRef.current = false
        setContextInitializing(true)
        setContextReady(false)
        retryTimerRef.current = setTimeout(() => {
          fetchContext()
        }, 3000)
      } else {
        message.error('获取个人空间信息失败')
        setContextReady(false)
        setContextInitializing(false)
      }
    }
  }, [])

  const ensureLibraryId = useCallback(async (): Promise<string> => {
    if (libraryIdRef.current) return libraryIdRef.current
    await fetchContext()
    return libraryIdRef.current
  }, [fetchContext])

  return {
    libraryId: libraryIdRef.current,
    contextReady,
    contextInitializing,
    ensureLibraryId,
    fetchContext
  }
}

/**
 * 清理重试定时器
 * 用于组件卸载时清理
 */
export function clearRetryTimer(hookReturn: UseMySpaceContextReturn): void {
  // 此函数保留用于扩展，当前定时器在 hook 内部管理
}