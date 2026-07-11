import { useState, useEffect, useCallback, useRef } from 'react'
import { enableBeforeUnloadProtection } from '@/utils/before-unload-guard'

interface EditSession {
  fileId: string
  libraryId: string
  tabId: string
  timestamp: number
  isEditing: boolean
}

// Cookie 工具函数
const cookieUtils = {
  setCookie(name: string, value: string, maxAge: number) {
    const expires = new Date()
    expires.setTime(expires.getTime() + maxAge)
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; samesite=lax`
  },

  getCookie(name: string): string | null {
    const nameEQ = encodeURIComponent(name) + '='
    const cookies = document.cookie.split(';')

    for (let cookie of cookies) {
      cookie = cookie.trim()
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length))
      }
    }

    return null
  },

  deleteCookie(name: string) {
    document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; samesite=lax`
  }
}

// 会话过期时间：5分钟（毫秒）
const SESSION_EXPIRE_TIME = 5 * 60 * 1000

export const useEditConflict = (fileId: string, libraryId: string) => {
  const [hasConflict, setHasConflict] = useState(false)
  const [conflictMessage, setConflictMessage] = useState('')
  const tabIdRef = useRef('')
  const checkIntervalRef = useRef<ReturnType<typeof setInterval>>()

  // 生成唯一的标签页ID
  const generateTabId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // 获取编辑会话的存储键
  const getStorageKey = useCallback(() => {
    return `edit_session_${libraryId}_${fileId}`
  }, [libraryId, fileId])

  // 获取所有会话
  const getSessions = useCallback((): EditSession[] => {
    const storageKey = getStorageKey()
    const cookieValue = cookieUtils.getCookie(storageKey)

    if (!cookieValue) {
      return []
    }

    try {
      const sessions = JSON.parse(cookieValue) as EditSession[]
      const now = Date.now()
      return sessions.filter((session) => now - session.timestamp < SESSION_EXPIRE_TIME)
    } catch (error) {
      console.warn('解析编辑会话 Cookie 失败:', error)
      return []
    }
  }, [getStorageKey])

  // 保存会话到 Cookie
  const saveSessions = useCallback((sessions: EditSession[]) => {
    const storageKey = getStorageKey()

    if (sessions.length === 0) {
      cookieUtils.deleteCookie(storageKey)
      return
    }

    cookieUtils.setCookie(storageKey, JSON.stringify(sessions), SESSION_EXPIRE_TIME)
  }, [getStorageKey])

  // 检查是否有其他标签页在编辑同一文件
  const checkEditConflict = useCallback(() => {
    const sessions = getSessions()

    const otherEditingSessions = sessions.filter(
      (session) => session.tabId !== tabIdRef.current && session.isEditing
    )

    if (otherEditingSessions.length > 0) {
      setHasConflict(true)
      setConflictMessage(window.$t?.('common.edit_conflict') || '其他标签页正在编辑此文件')
      return true
    }

    setHasConflict(false)
    setConflictMessage('')
    return false
  }, [getSessions])

  // 注册编辑会话
  const registerEditSession = useCallback((isEditing: boolean) => {
    const sessions = getSessions()
    const otherSessions = sessions.filter((session) => session.tabId !== tabIdRef.current)

    const newSession: EditSession = {
      fileId,
      libraryId,
      tabId: tabIdRef.current,
      timestamp: Date.now(),
      isEditing
    }

    saveSessions([...otherSessions, newSession])
  }, [fileId, libraryId, getSessions, saveSessions])

  // 移除编辑会话
  const removeEditSession = useCallback(() => {
    const sessions = getSessions()
    const remainingSessions = sessions.filter((session) => session.tabId !== tabIdRef.current)
    saveSessions(remainingSessions)
  }, [getSessions, saveSessions])

  // 开始编辑
  const startEdit = useCallback(() => {
    if (checkEditConflict()) {
      return false
    }
    registerEditSession(true)
    return true
  }, [checkEditConflict, registerEditSession])

  // 结束编辑
  const endEdit = useCallback(() => {
    registerEditSession(false)
  }, [registerEditSession])

  useEffect(() => {
    // 生成标签页ID
    tabIdRef.current = generateTabId()

    // 页面可见性变化处理
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkEditConflict()
      }
    }

    // 页面卸载前处理
    const handleBeforeUnload = () => {
      removeEditSession()
    }

    // 启用 beforeunload 保护标记
    const disableProtection = enableBeforeUnloadProtection()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    // 初始检查冲突
    checkEditConflict()

    // 定期检查冲突
    checkIntervalRef.current = setInterval(() => {
      checkEditConflict()
    }, 10 * 1000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      disableProtection()

      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }

      removeEditSession()
    }
  }, [checkEditConflict, removeEditSession])

  return {
    hasConflict,
    conflictMessage,
    startEdit,
    endEdit,
    checkEditConflict
  }
}

export default useEditConflict
