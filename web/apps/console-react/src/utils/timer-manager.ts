import { useEffect, useMemo } from 'react'

export type TimerType = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

export interface TimerInfo {
  id: TimerType
  type: 'timeout' | 'interval'
  callback: () => void
  delay: number
  createdAt: number
}

export class TimerManager {
  private timers = new Map<string, TimerInfo>()
  private timerIdCounter = 0

  setTimeout(callback: () => void, delay: number, key?: string): string {
    const timerKey = key || `timer_${++this.timerIdCounter}`
    this.clearTimer(timerKey)
    const id = setTimeout(() => {
      callback()
      this.timers.delete(timerKey)
    }, delay)
    this.timers.set(timerKey, { id, type: 'timeout', callback, delay, createdAt: Date.now() })
    return timerKey
  }

  setInterval(callback: () => void, delay: number, key?: string): string {
    const timerKey = key || `interval_${++this.timerIdCounter}`
    this.clearTimer(timerKey)
    const id = setInterval(callback, delay)
    this.timers.set(timerKey, { id, type: 'interval', callback, delay, createdAt: Date.now() })
    return timerKey
  }

  clearTimer(key: string): boolean {
    const timer = this.timers.get(key)
    if (timer) {
      if (timer.type === 'timeout') clearTimeout(timer.id)
      else clearInterval(timer.id)
      this.timers.delete(key)
      return true
    }
    return false
  }

  clearAll(): void {
    this.timers.forEach(timer => {
      if (timer.type === 'timeout') clearTimeout(timer.id)
      else clearInterval(timer.id)
    })
    this.timers.clear()
  }

  getTimer(key: string): TimerInfo | undefined {
    return this.timers.get(key)
  }

  getAllTimers(): Map<string, TimerInfo> {
    return new Map(this.timers)
  }

  hasTimer(key: string): boolean {
    return this.timers.has(key)
  }

  getTimerCount(): number {
    return this.timers.size
  }

  clearExpiredTimers(maxAge = 30000): number {
    const now = Date.now()
    let clearedCount = 0
    this.timers.forEach((timer, key) => {
      if (timer.type === 'timeout' && now - timer.createdAt > maxAge) {
        this.clearTimer(key)
        clearedCount++
      }
    })
    return clearedCount
  }
}

export const globalTimerManager = new TimerManager()

/**
 * React Hook：返回定时器方法，在组件卸载时自动 clearAll
 */
export function useTimerManager() {
  const manager = useMemo(() => new TimerManager(), [])

  useEffect(() => {
    return () => {
      manager.clearAll()
    }
  }, [manager])

  return {
    setTimeout: manager.setTimeout.bind(manager),
    setInterval: manager.setInterval.bind(manager),
    clearTimer: manager.clearTimer.bind(manager),
    clearAll: manager.clearAll.bind(manager),
    getTimer: manager.getTimer.bind(manager),
    hasTimer: manager.hasTimer.bind(manager),
    getTimerCount: manager.getTimerCount.bind(manager),
  }
}
