/**
 * 异步处理工具函数
 */

/**
 * 睡眠函数
 * @param ms 毫秒数
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 在浏览器空闲时执行回调
 */
export const runOnIdle = (
  callback: () => void,
  options?: { timeout?: number }
): number => {
  if ('requestIdleCallback' in window) {
    return (window as any).requestIdleCallback(callback, options)
  }
  return setTimeout(callback, options?.timeout || 0) as unknown as number
}

export interface IdleCallbackOptions {
  timeout?: number
}

/**
 * 重试函数 - 在失败时自动重试执行函数，支持指数退避策略
 *
 * @template T - 返回值类型
 * @param fn - 要重试的异步函数
 * @param maxRetries - 最大重试次数，默认为3
 * @param retryDelay - 初始重试延迟（毫秒），默认为1000
 * @returns Promise<T> - 函数执行成功的结果
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  retryDelay = 1000
): Promise<T> => {
  if (typeof fn !== 'function') {
    throw new Error('Function to retry must be a function')
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('Max retries must be a non-negative integer')
  }

  if (retryDelay < 0) {
    throw new Error('Retry delay must be non-negative')
  }

  let lastError: Error

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (i === maxRetries) {
        throw lastError
      }

      // 指数退避策略：每次重试延迟时间翻倍
      await sleep(retryDelay * Math.pow(2, i))
    }
  }

  throw lastError!
}
