/**
 * 通用事件总线
 * 支持事件缓存、once 监听、监听器计数等功能
 */

type EventCallback = (data?: any) => void

interface EventMap {
  [eventName: string]: EventCallback[]
}

interface CachedEvent {
  data: any
  timestamp: number
}

interface CachedEventMap {
  [eventName: string]: CachedEvent
}

const eventBus = {
  events: {} as EventMap,
  cachedEvents: {} as CachedEventMap,
  cacheableEvents: new Set<string>(),

  /**
   * 触发事件
   * @param eventName 事件名称
   * @param data 事件数据
   */
  emit(eventName: string, data?: any) {
    if (this.events[eventName] && this.events[eventName].length > 0) {
      this.events[eventName].forEach((callback) => callback(data))
    }

    if (this.cacheableEvents.has(eventName)) {
      this.cachedEvents[eventName] = {
        data,
        timestamp: Date.now(),
      }
    }

    return this
  },

  /**
   * 监听事件
   * @param eventName 事件名称
   * @param callback 回调函数
   */
  on(eventName: string, callback: EventCallback) {
    this.events[eventName] = this.events[eventName] || []
    this.events[eventName].push(callback)

    if (this.cachedEvents[eventName]) {
      callback(this.cachedEvents[eventName].data)
    }

    return this
  },

  /**
   * 监听事件一次（触发后自动移除）
   * @param eventName 事件名称
   * @param callback 回调函数
   */
  once(eventName: string, callback: EventCallback) {
    const onceWrapper = (data?: any) => {
      callback(data)
      this.off(eventName, onceWrapper)
    }

    this.events[eventName] = this.events[eventName] || []
    this.events[eventName].push(onceWrapper)

    if (this.cachedEvents[eventName]) {
      onceWrapper(this.cachedEvents[eventName].data)
    }

    return this
  },

  /**
   * 移除事件监听
   * @param eventName 事件名称
   * @param callback 可选的回调函数，如果不提供则移除该事件的所有监听器
   */
  off(eventName: string, callback?: EventCallback) {
    if (this.events[eventName]) {
      if (callback) {
        this.events[eventName] = this.events[eventName].filter((cb) => cb !== callback)
      } else {
        delete this.events[eventName]
      }
    }
    return this
  },

  /**
   * 获取指定事件的监听器数量
   */
  listenerCount(eventName: string): number {
    return this.events[eventName]?.length || 0
  },

  /**
   * 移除所有事件监听器
   */
  clear() {
    this.events = {}
    return this
  },

  /**
   * 添加可缓存的事件类型
   */
  addCacheableEvent(eventName: string) {
    this.cacheableEvents.add(eventName)
    return this
  },

  /**
   * 移除可缓存的事件类型
   */
  removeCacheableEvent(eventName: string) {
    this.cacheableEvents.delete(eventName)
    delete this.cachedEvents[eventName]
    return this
  },

  /**
   * 清除事件缓存
   */
  clearCache(eventName?: string) {
    if (eventName) {
      delete this.cachedEvents[eventName]
    } else {
      this.cachedEvents = {}
    }
    return this
  },

  /**
   * 获取缓存的事件数据
   */
  getCachedEvent(eventName: string): CachedEvent | undefined {
    return this.cachedEvents[eventName]
  },

  /**
   * 检查是否有缓存的事件
   */
  hasCachedEvent(eventName: string): boolean {
    return eventName in this.cachedEvents
  },

  /**
   * 清除所有数据（包括监听器和缓存）
   */
  clearAll() {
    this.events = {}
    this.cachedEvents = {}
    return this
  },
}

export { eventBus }
