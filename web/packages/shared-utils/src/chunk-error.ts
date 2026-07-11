/**
 * Chunk 加载失败处理
 *
 * 场景：代码部署后旧 chunk 文件被删除，
 *       用户浏览器中缓存的旧页面路由切换时无法加载新 chunk
 *
 * 方案：检测到 chunk 加载失败后强制刷新页面
 */

const STORAGE_KEY = 'chunk_reload_timestamp'
const RELOAD_COOLDOWN = 10000 // 10秒内不重复刷新

let isHandling = false

/**
 * 检测是否为 chunk 加载失败的错误
 */
export function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    error.message.includes('Loading chunk') ||
    error.message.includes('Loading CSS chunk') ||
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Unable to preload CSS') ||
    error.message.includes('imported module') ||
    error.message.includes('.js not found') ||
    error.message.includes('.css not found') ||
    error.message.match(/failed to fetch|chunk.*failed|loading chunk|not found/i) !== null
  )
}

/**
 * 处理 chunk 加载失败
 * 检测是否为 chunk 加载错误，若是则刷新页面
 *
 * @returns true 表示是 chunk 错误并已处理，false 表示不是 chunk 错误
 */
export function handleChunkLoadError(error: Error): boolean {
  if (!isChunkLoadError(error)) return false

  // 防止短时间内重复刷新
  const lastReload = localStorage.getItem(STORAGE_KEY)
  const now = Date.now()
  if (lastReload && now - parseInt(lastReload) < RELOAD_COOLDOWN) {
    console.warn('[ChunkHandler] 频繁检测到 chunk 失败，跳过刷新')
    return true
  }

  if (isHandling) return true
  isHandling = true

  console.warn('[ChunkHandler] 检测到 chunk 加载失败，正在刷新页面...')
  localStorage.setItem(STORAGE_KEY, now.toString())

  // 提示用户（使用系统设计令牌）
  const tip = document.createElement('div')
  tip.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 16px 24px;
      background: #2563eb;
      color: #fff;
      text-align: center;
      font-size: 14px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      animation: chunk-slide-down 300ms ease;
    ">
      <style>
        @keyframes chunk-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes chunk-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
        <svg style="animation: chunk-spin 1s linear infinite; width: 18px; height: 18px; flex-shrink: 0;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span>系统已更新，正在刷新页面加载最新版本...</span>
      </div>
    </div>
  `
  document.body.appendChild(tip)

  // 延迟刷新，让用户看到提示
  // 使用时间戳参数强制跳过缓存
  setTimeout(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('_refresh', Date.now().toString())
    window.location.href = url.toString()
  }, 500)

  return true
}

/**
 * 初始化全局错误监听
 * 捕获未处理的 chunk 加载错误
 */
export function setupChunkErrorHandler() {
  // 捕获全局 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof Error) {
      if (handleChunkLoadError(event.reason)) {
        event.preventDefault()
      }
    }
  })

  // 捕获全局错误
  window.addEventListener('error', (event) => {
    if (event.error instanceof Error) {
      handleChunkLoadError(event.error)
    }
  })

  // 清理过期的刷新时间戳
  const lastReload = localStorage.getItem(STORAGE_KEY)
  if (lastReload) {
    const elapsed = Date.now() - parseInt(lastReload)
    if (elapsed > RELOAD_COOLDOWN) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
}

export default {
  isChunkLoadError,
  handleChunkLoadError,
  setupChunkErrorHandler,
}
