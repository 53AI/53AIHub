import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'
import { t } from '@/locales'
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

  const [libraryId, setLibraryId] = useState('')
  const [contextReady, setContextReady] = useState(false)
  const [contextInitializing, setContextInitializing] = useState(false)

  // 卸载时清理 429 重试定时器，避免卸载后 setState
  useEffect(() => () => clearTimeout(retryTimerRef.current), [])

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
      setLibraryId(ctx.library_id)
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
        message.error(t('mine.fetch_space_failed'))
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
    libraryId,
    contextReady,
    contextInitializing,
    ensureLibraryId,
    fetchContext
  }
}