/**
 * 通用异步工具：sleep、loadScript
 */

/**
 * 睡眠（秒）
 */
export const sleep = (time: number): Promise<void> => {
  if (time < 0) {
    throw new Error('Sleep time must be non-negative')
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve()
      clearTimeout(timer)
    }, time * 1000)
  })
}

/**
 * 动态加载脚本（带缓存，避免重复插入同一 src）
 */
export const loadScript = (src: string, cache = true): Promise<void> => {
  return new Promise((resolve, reject) => {
    const node = document.querySelector(`script[src="${src}"]`)
    if (node) {
      if (cache) return resolve()
      node.remove()
    }

    const element = document.createElement('script')
    element.src = src
    element.referrerPolicy = 'origin'
    element.onload = () => resolve()
    element.onerror = () => reject()
    document.body.appendChild(element)
  })
}

/**
 * 移除已加载的脚本节点
 */
export const removeScript = (src: string): void => {
  const node = document.querySelector(`script[src="${src}"]`)
  if (node) node.remove()
}


/** 空闲回调选项 */
export interface IdleCallbackOptions {
  timeout?: number
}

interface IdleDeadline {
  didTimeout: boolean
  timeRemaining(): number
}

type IdleCallback = (deadline: IdleDeadline) => void

const idleQueue: IdleCallback[] = []
let isRunning = false

const executeNextTask = (deadline: IdleDeadline) => {
  if (isRunning || !idleQueue.length) return
  isRunning = true
  const task = idleQueue.shift()
  try {
    task?.(deadline)
  } catch (error) {
    console.error('Error executing idle task:', error)
  } finally {
    isRunning = false
    if (idleQueue.length > 0) scheduleNextTask()
  }
}

const scheduleNextTask = () => {
  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    window.requestIdleCallback(executeNextTask)
  } else {
    setTimeout(() => {
      executeNextTask({
        didTimeout: false,
        timeRemaining: () => 16.67,
      })
    }, 0)
  }
}

/**
 * 在浏览器空闲时执行任务
 */
export const runOnIdle = (
  callback: IdleCallback,
  options: IdleCallbackOptions = {}
): void => {
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function')
  }
  idleQueue.push(callback)
  if (!isRunning) {
    if (typeof window !== 'undefined' && window.requestIdleCallback) {
      window.requestIdleCallback(executeNextTask, options)
    } else {
      setTimeout(() => {
        executeNextTask({ didTimeout: false, timeRemaining: () => 16.67 })
      }, 0)
    }
  }
}
