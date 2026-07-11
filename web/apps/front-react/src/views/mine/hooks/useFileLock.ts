import { useRef, useEffect, useCallback } from 'react'
import filesApi from '@/api/modules/files'
import { api_host } from '@/utils/config'

interface UseFileLockOptions {
  fileId: string
  enabled?: boolean
}

interface UseFileLockReturn {
  addLock: () => Promise<{ success: boolean; message: string }>
  releaseLock: (sync?: boolean) => void
  startTimer: () => void
  stopTimer: () => void
}

/**
 * 文件锁管理 hook
 * 用于编辑文件时的锁机制，防止多人同时编辑
 */
const LOCK_REFRESH_INTERVAL = 15 * 1000 // 15秒

export function useFileLock({ fileId, enabled = true }: UseFileLockOptions): UseFileLockReturn {
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * 添加文件锁
   */
  const addLock = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await filesApi.lock(fileId, { action: 'add' })
      return {
        success: res.success,
        message: res.message
      }
    } catch (error: unknown) {
      console.error('添加文件锁失败:', error)
      const err = error as { response?: { data?: { data?: { message?: string } } } }
      return {
        success: false,
        message: err?.response?.data?.data?.message || '添加文件锁失败'
      }
    }
  }, [fileId])

  /**
   * 释放文件锁
   */
  const releaseLock = useCallback((sync = false) => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    fetch(`${api_host}/api/files/${fileId}/edit-lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      keepalive: true,
      body: JSON.stringify({ action: 'delete' })
    }).catch((error) => {
      console.error('释放文件锁失败:', error)
    })
  }, [fileId])

  /**
   * 停止定时刷新锁
   */
  const stopTimer = useCallback(() => {
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current)
      lockTimerRef.current = null
    }
  }, [])

  /**
   * 开始定时刷新锁（每15秒）
   */
  const startTimer = useCallback(() => {
    stopTimer()
    lockTimerRef.current = setInterval(() => {
      filesApi.lock(fileId, { action: 'add' }).catch((error) => {
        console.error('定时刷新文件锁失败:', error)
      })
    }, LOCK_REFRESH_INTERVAL)
  }, [fileId, stopTimer])

  // 清理定时器
  useEffect(() => {
    if (!enabled) return
    return () => stopTimer()
  }, [enabled, stopTimer])

  return {
    addLock,
    releaseLock,
    startTimer,
    stopTimer
  }
}

export default useFileLock