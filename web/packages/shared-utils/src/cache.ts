/**
 * 缓存管理工具类
 * 提供多种缓存模式，支持过期时间和泛型数据类型
 */

/** 缓存模式枚举 */
export enum CacheMode {
  /** 内存缓存（默认） */
  MEMORY = 'memory',
  /** SessionStorage 缓存 */
  SESSION_STORAGE = 'sessionStorage',
  /** LocalStorage 缓存 */
  LOCAL_STORAGE = 'localStorage',
  /** IndexedDB 缓存 */
  INDEXED_DB = 'indexedDB',
  /** Cookie 缓存 */
  COOKIE = 'cookie'
}

/** 数据获取器类型定义 */
type Fetcher<T> = (() => Promise<T>) | (() => T) | T

/** 缓存项接口定义 */
interface CacheItem<T> {
  /** 缓存的数据 */
  data: T
  /** 过期时间戳 */
  expireTime: number
  /** 缓存模式 */
  mode: CacheMode
}

/** 缓存适配器接口 */
interface CacheAdapter {
  /** 设置缓存 */
  set<T>(key: string, value: CacheItem<T>): Promise<void> | void
  /** 获取缓存 */
  get<T>(key: string): Promise<CacheItem<T> | null> | CacheItem<T> | null
  /** 删除缓存 */
  delete(key: string): Promise<void> | void
  /** 清空缓存 */
  clear(): Promise<void> | void
  /** 获取所有键 */
  keys(): Promise<string[]> | string[]
}

/** Cookie 工具函数 */
class CookieUtils {
  /**
   * 设置 Cookie
   * @param name Cookie 名称
   * @param value Cookie 值
   * @param options Cookie 选项
   */
  static setCookie(name: string, value: string, options: {
    expires?: Date | number
    path?: string
    domain?: string
    secure?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
  } = {}): void {
    let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`

    if (options.expires) {
      if (typeof options.expires === 'number') {
        const date = new Date()
        date.setTime(date.getTime() + options.expires * 24 * 60 * 60 * 1000)
        cookieString += `; expires=${date.toUTCString()}`
      } else {
        cookieString += `; expires=${options.expires.toUTCString()}`
      }
    }

    if (options.path) {
      cookieString += `; path=${options.path}`
    }

    if (options.domain) {
      cookieString += `; domain=${options.domain}`
    }

    if (options.secure) {
      cookieString += '; secure'
    }

    if (options.sameSite) {
      cookieString += `; samesite=${options.sameSite}`
    }

    document.cookie = cookieString
  }

  /**
   * 获取 Cookie
   * @param name Cookie 名称
   * @returns Cookie 值或 null
   */
  static getCookie(name: string): string | null {
    const nameEQ = encodeURIComponent(name) + '='
    const cookies = document.cookie.split(';')

    for (let cookie of cookies) {
      cookie = cookie.trim()
      if (cookie.indexOf(nameEQ) === 0) {
        return decodeURIComponent(cookie.substring(nameEQ.length))
      }
    }

    return null
  }

  /**
   * 删除 Cookie
   * @param name Cookie 名称
   * @param path Cookie 路径
   * @param domain Cookie 域名
   */
  static deleteCookie(name: string, path?: string, domain?: string): void {
    this.setCookie(name, '', {
      expires: new Date(0),
      path,
      domain
    })
  }

  /**
   * 获取所有 Cookie 名称
   * @returns Cookie 名称数组
   */
  static getAllCookieNames(): string[] {
    if (!document.cookie) return []

    return document.cookie
      .split(';')
      .map(cookie => cookie.trim().split('=')[0])
      .map(name => decodeURIComponent(name))
  }
}

/** 内存缓存适配器 */
class MemoryCacheAdapter implements CacheAdapter {
  private cacheMap: Map<string, CacheItem<unknown>> = new Map()

  set<T>(key: string, value: CacheItem<T>): void {
    this.cacheMap.set(key, value as CacheItem<unknown>)
  }

  get<T>(key: string): CacheItem<T> | null {
    return this.cacheMap.get(key) as CacheItem<T> | null
  }

  delete(key: string): void {
    this.cacheMap.delete(key)
  }

  clear(): void {
    this.cacheMap.clear()
  }

  keys(): string[] {
    return Array.from(this.cacheMap.keys())
  }
}

/** SessionStorage 缓存适配器 */
class SessionStorageCacheAdapter implements CacheAdapter {
  private readonly prefix = 'cache_'

  set<T>(key: string, value: CacheItem<T>): void {
    try {
      const storageKey = this.prefix + key
      sessionStorage.setItem(storageKey, JSON.stringify(value))
    } catch (error) {
      console.warn('SessionStorage 缓存设置失败:', error)
    }
  }

  get<T>(key: string): CacheItem<T> | null {
    try {
      const storageKey = this.prefix + key
      const item = sessionStorage.getItem(storageKey)
      return item ? JSON.parse(item) : null
    } catch (error) {
      console.warn('SessionStorage 缓存获取失败:', error)
      return null
    }
  }

  delete(key: string): void {
    try {
      const storageKey = this.prefix + key
      sessionStorage.removeItem(storageKey)
    } catch (error) {
      console.warn('SessionStorage 缓存删除失败:', error)
    }
  }

  clear(): void {
    try {
      const keys = Object.keys(sessionStorage)
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          sessionStorage.removeItem(key)
        }
      })
    } catch (error) {
      console.warn('SessionStorage 缓存清空失败:', error)
    }
  }

  keys(): string[] {
    try {
      const keys = Object.keys(sessionStorage)
      return keys
        .filter(key => key.startsWith(this.prefix))
        .map(key => key.substring(this.prefix.length))
    } catch (error) {
      console.warn('SessionStorage 获取键列表失败:', error)
      return []
    }
  }
}

/** LocalStorage 缓存适配器 */
class LocalStorageCacheAdapter implements CacheAdapter {
  private readonly prefix = 'cache_'

  set<T>(key: string, value: CacheItem<T>): void {
    try {
      const storageKey = this.prefix + key
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch (error) {
      console.warn('LocalStorage 缓存设置失败:', error)
    }
  }

  get<T>(key: string): CacheItem<T> | null {
    try {
      const storageKey = this.prefix + key
      const item = localStorage.getItem(storageKey)
      return item ? JSON.parse(item) : null
    } catch (error) {
      console.warn('LocalStorage 缓存获取失败:', error)
      return null
    }
  }

  delete(key: string): void {
    try {
      const storageKey = this.prefix + key
      localStorage.removeItem(storageKey)
    } catch (error) {
      console.warn('LocalStorage 缓存删除失败:', error)
    }
  }

  clear(): void {
    try {
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key)
        }
      })
    } catch (error) {
      console.warn('LocalStorage 缓存清空失败:', error)
    }
  }

  keys(): string[] {
    try {
      const keys = Object.keys(localStorage)
      return keys
        .filter(key => key.startsWith(this.prefix))
        .map(key => key.substring(this.prefix.length))
    } catch (error) {
      console.warn('LocalStorage 获取键列表失败:', error)
      return []
    }
  }
}

/** IndexedDB 缓存适配器 */
class IndexedDBCacheAdapter implements CacheAdapter {
  private readonly dbName = 'CacheDB'
  private readonly storeName = 'cache'
  private readonly version = 1
  private db: IDBDatabase | null = null

  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' })
        }
      }
    })
  }

  async set<T>(key: string, value: CacheItem<T>): Promise<void> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      store.put({ key, ...value })
    } catch (error) {
      console.warn('IndexedDB 缓存设置失败:', error)
    }
  }

  async get<T>(key: string): Promise<CacheItem<T> | null> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)

      return new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            const { key: _, ...cacheItem } = result
            resolve(cacheItem as CacheItem<T>)
          } else {
            resolve(null)
          }
        }
      })
    } catch (error) {
      console.warn('IndexedDB 缓存获取失败:', error)
      return null
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      store.delete(key)
    } catch (error) {
      console.warn('IndexedDB 缓存删除失败:', error)
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      store.clear()
    } catch (error) {
      console.warn('IndexedDB 缓存清空失败:', error)
    }
  }

  async keys(): Promise<string[]> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)

      return new Promise((resolve, reject) => {
        const request = store.getAllKeys()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result as string[])
      })
    } catch (error) {
      console.warn('IndexedDB 获取键列表失败:', error)
      return []
    }
  }
}

/** Cookie 缓存适配器 */
class CookieCacheAdapter implements CacheAdapter {
  private readonly prefix = 'cache_'
  private readonly maxValueSize = 3000 // 考虑编码后的实际值大小限制

  set<T>(key: string, value: CacheItem<T>): void {
    try {
      const cookieKey = this.prefix + key
      const serializedValue = JSON.stringify(value)

      // 检查数据大小是否超过 Cookie 限制
      if (serializedValue.length > this.maxValueSize) {
        console.warn(`Cookie 缓存数据过大，跳过存储: ${key}`, {
          size: serializedValue.length,
          maxSize: this.maxValueSize
        })
        return
      }

      // 计算过期时间（相对于当前时间的天数）
      const now = Date.now()
      const expireTime = value.expireTime
      const daysUntilExpiry = Math.ceil((expireTime - now) / (1000 * 60 * 60 * 24))

      CookieUtils.setCookie(cookieKey, serializedValue, {
        expires: daysUntilExpiry,
        path: '/',
        sameSite: 'lax'
      })
    } catch (error) {
      console.warn('Cookie 缓存设置失败:', error)
    }
  }

  get<T>(key: string): CacheItem<T> | null {
    try {
      const cookieKey = this.prefix + key
      const cookieValue = CookieUtils.getCookie(cookieKey)

      if (!cookieValue) return null

      const cacheItem = JSON.parse(cookieValue) as CacheItem<T>

      // 检查是否过期
      if (Date.now() >= cacheItem.expireTime) {
        this.delete(key)
        return null
      }

      return cacheItem
    } catch (error) {
      console.warn('Cookie 缓存获取失败:', error)
      return null
    }
  }

  delete(key: string): void {
    try {
      const cookieKey = this.prefix + key
      CookieUtils.deleteCookie(cookieKey, '/')
    } catch (error) {
      console.warn('Cookie 缓存删除失败:', error)
    }
  }

  clear(): void {
    try {
      const allCookieNames = CookieUtils.getAllCookieNames()
      const cacheCookieNames = allCookieNames.filter(name => name.startsWith(this.prefix))

      cacheCookieNames.forEach(name => {
        const key = name.substring(this.prefix.length)
        this.delete(key)
      })
    } catch (error) {
      console.warn('Cookie 缓存清空失败:', error)
    }
  }

  keys(): string[] {
    try {
      const allCookieNames = CookieUtils.getAllCookieNames()
      return allCookieNames
        .filter(name => name.startsWith(this.prefix))
        .map(name => name.substring(this.prefix.length))
    } catch (error) {
      console.warn('Cookie 获取键列表失败:', error)
      return []
    }
  }
}

/**
 * 缓存管理器类
 * 使用单例模式，提供全局统一的缓存管理
 */
export class CacheManager {
  /** 单例实例 */
  // eslint-disable-next-line no-use-before-define
  private static instance: CacheManager | null = null

  /** 缓存适配器映射 */
  private adapters: Map<CacheMode, CacheAdapter> = new Map()

  /** 正在执行的 Promise 缓存，避免同一 key 的并发请求 */
  private pendingPromises: Map<string, Promise<unknown>> = new Map()

  /**
   * 获取单例实例
   * @returns CacheManager 实例
   */
  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager()
    }
    return CacheManager.instance
  }

  /**
   * 构造函数，初始化缓存适配器
   */
  constructor() {
    this.adapters.set(CacheMode.MEMORY, new MemoryCacheAdapter())
    this.adapters.set(CacheMode.SESSION_STORAGE, new SessionStorageCacheAdapter())
    this.adapters.set(CacheMode.LOCAL_STORAGE, new LocalStorageCacheAdapter())
    this.adapters.set(CacheMode.INDEXED_DB, new IndexedDBCacheAdapter())
    this.adapters.set(CacheMode.COOKIE, new CookieCacheAdapter())
  }

  /**
   * 获取指定模式的缓存适配器
   * @param mode 缓存模式
   * @returns 缓存适配器
   */
  private getAdapter(mode: CacheMode = CacheMode.MEMORY): CacheAdapter {
    const adapter = this.adapters.get(mode)
    if (!adapter) {
      throw new Error(`不支持的缓存模式: ${mode}`)
    }
    return adapter
  }

  /**
   * 判断值是否为 Promise
   * @param value 待检查的值
   * @returns 是否为 Promise
   */
  private isPromise<T>(value: unknown): value is Promise<T> {
    return value != null && typeof (value as { then?: unknown }).then === 'function'
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param expireMinutes 过期时间（分钟），默认 1 分钟
   * @param mode 缓存模式，默认内存缓存
   */
  async set<T>(key: string, value: T, expireMinutes = 1, mode: CacheMode = CacheMode.MEMORY): Promise<void> {
    const expireTime = Date.now() + expireMinutes * 60 * 1000
    const cacheItem: CacheItem<T> = {
      data: value,
      expireTime,
      mode,
    }

    const adapter = this.getAdapter(mode)
    await adapter.set(key, cacheItem)
  }

  /**
   * 获取缓存
   * @param key 缓存键
   * @param mode 缓存模式，默认内存缓存
   * @returns 缓存值，如果不存在或已过期则返回 null
   */
  async get<T>(key: string, mode: CacheMode = CacheMode.MEMORY): Promise<T | null> {
    const now = Date.now()
    const adapter = this.getAdapter(mode)
    const cacheItem = await adapter.get<T>(key)

    if (cacheItem && now < cacheItem.expireTime) {
      return cacheItem.data
    }

    // 清理过期缓存
    if (cacheItem) {
      await adapter.delete(key)
    }
    return null
  }

  /**
   * 获取缓存或执行获取函数
   * 如果缓存存在且未过期，直接返回缓存值
   * 否则执行获取函数并缓存结果
   *
   * @param key 缓存键
   * @param fetcher 数据获取器，可以是函数、异步函数或直接的值
   * @param expireMinutes 过期时间（分钟），默认 2 分钟
   * @param mode 缓存模式，默认内存缓存
   * @returns 缓存或获取的数据
   *
   * @example
   * ```typescript
   * // 缓存API请求结果到内存
   * const userData = await cache.getOrFetch(
   *   'user:123',
   *   () => fetch('/api/user/123').then(res => res.json()),
   *   5, // 5分钟过期
   *   CacheMode.MEMORY
   * )
   *
   * // 缓存计算结果到 localStorage
   * const computed = await cache.getOrFetch(
   *   'expensive-calc',
   *   () => expensiveCalculation(),
   *   30, // 30分钟过期
   *   CacheMode.LOCAL_STORAGE
   * )
   *
   * // 缓存用户设置到 sessionStorage
   * const settings = await cache.getOrFetch(
   *   'user-settings',
   *   () => loadUserSettings(),
   *   60, // 1小时过期
   *   CacheMode.SESSION_STORAGE
   * )
   *
   * // 缓存大量数据到 IndexedDB
   * const largeData = await cache.getOrFetch(
   *   'large-dataset',
   *   () => fetchLargeDataset(),
   *   120, // 2小时过期
   *   CacheMode.INDEXED_DB
   * )
   * ```
   */
  async getOrFetch<T>(key: string, fetcher: Fetcher<T>, expireMinutes = 2, mode: CacheMode = CacheMode.MEMORY): Promise<T> {
    // 检查缓存
    const cachedValue = await this.get<T>(key, mode)
    if (cachedValue !== null) return cachedValue

    // 检查是否有正在执行的相同 key 的 Promise
    const pendingKey = `${mode}:${key}`
    if (this.pendingPromises.has(pendingKey)) {
      // 如果有正在执行的 Promise，直接等待它完成
      return this.pendingPromises.get(pendingKey) as Promise<T>
    }

    // 处理不同类型的 fetcher
    let result: T | Promise<T>
    if (typeof fetcher === 'function') {
      const fetchResult = (fetcher as () => T | Promise<T>)()
      result = fetchResult
    } else {
      result = fetcher
    }

    // 如果是 Promise，需要先缓存 Promise 再等待解析
    if (this.isPromise<T>(result)) {
      // 将 Promise 缓存起来，避免并发请求
      this.pendingPromises.set(pendingKey, result as Promise<unknown>)

      try {
        const resolvedResult = await result
        // 存储解析后的结果
        await this.set(key, resolvedResult, expireMinutes, mode)
        return resolvedResult
      } catch (error) {
        // Promise 被拒绝时，不存储任何内容
        throw error
      } finally {
        // 无论成功还是失败，都要清理 pending Promise
        this.pendingPromises.delete(pendingKey)
      }
    } else {
      // 非 Promise 直接存储
      await this.set(key, result, expireMinutes, mode)
      return result
    }
  }

  /**
   * 删除指定缓存
   * @param key 缓存键
   * @param mode 缓存模式，默认内存缓存
   */
  async delete(key: string, mode: CacheMode = CacheMode.MEMORY): Promise<void> {
    const adapter = this.getAdapter(mode)
    await adapter.delete(key)
  }

  /**
   * 清空指定模式的所有缓存
   * @param mode 缓存模式，默认内存缓存
   */
  async clear(mode: CacheMode = CacheMode.MEMORY): Promise<void> {
    const adapter = this.getAdapter(mode)
    await adapter.clear()
  }

  /**
   * 清空所有缓存模式的数据
   */
  async clearAll(): Promise<void> {
    const clearPromises = Array.from(this.adapters.keys()).map(mode => this.clear(mode))
    await Promise.all(clearPromises)
  }

  /**
   * 获取指定模式的缓存状态信息
   * @param mode 缓存模式，默认内存缓存
   * @returns 缓存统计信息
   */
  async getStats(mode: CacheMode = CacheMode.MEMORY): Promise<{
    /** 缓存项总数 */
    total: number
    /** 有效缓存项数量 */
    valid: number
    /** 过期缓存项数量 */
    expired: number
  }> {
    const adapter = this.getAdapter(mode)
    const keys = await adapter.keys()
    const now = Date.now()
    let validCount = 0
    let expiredCount = 0

    for (const key of keys) {
      const item = await adapter.get(key)
      if (item) {
        if (now < item.expireTime) {
          validCount++
        } else {
          expiredCount++
        }
      }
    }

    return {
      total: keys.length,
      valid: validCount,
      expired: expiredCount,
    }
  }

  /**
   * 获取所有缓存模式的统计信息
   * @returns 各模式的缓存统计信息
   */
  async getAllStats(): Promise<Record<CacheMode, {
    total: number
    valid: number
    expired: number
  }>> {
    const stats: Record<string, any> = {}
    const modes = Array.from(this.adapters.keys())

    for (const mode of modes) {
      stats[mode] = await this.getStats(mode)
    }

    return stats as Record<CacheMode, {
      total: number
      valid: number
      expired: number
    }>
  }

  /**
   * 清理指定模式的过期缓存
   * @param mode 缓存模式，默认内存缓存
   * @returns 清理的缓存项数量
   */
  async cleanExpired(mode: CacheMode = CacheMode.MEMORY): Promise<number> {
    const adapter = this.getAdapter(mode)
    const keys = await adapter.keys()
    const now = Date.now()
    let cleanedCount = 0

    for (const key of keys) {
      const item = await adapter.get(key)
      if (item && now >= item.expireTime) {
        await adapter.delete(key)
        cleanedCount++
      }
    }

    return cleanedCount
  }

  /**
   * 清理所有模式的过期缓存
   * @returns 各模式清理的缓存项数量
   */
  async cleanAllExpired(): Promise<Record<CacheMode, number>> {
    const results: Record<string, number> = {}
    const modes = Array.from(this.adapters.keys())

    for (const mode of modes) {
      results[mode] = await this.cleanExpired(mode)
    }

    return results as Record<CacheMode, number>
  }
}

/** 默认导出缓存管理器单例实例 */
export const cacheManager = CacheManager.getInstance()
