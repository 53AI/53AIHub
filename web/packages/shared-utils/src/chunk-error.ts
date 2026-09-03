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
let bannerEl: HTMLDivElement | null = null

/**
 * 渲染顶部提示条。
 *
 * @param manual 是否手动模式（冷却命中 / 已在处理中时，不再静默等刷新，
 *               而是给用户一个可点击的"立即刷新"按钮，避免长时间白屏卡死）
 */
function showBanner(manual: boolean) {
  if (bannerEl) bannerEl.remove()

  bannerEl = document.createElement('div')
  bannerEl.innerHTML = `
    <div style="
      position: fixed;
      top: 0; left: 0; right: 0; z-index: 9999;
      background: #2563eb; color: #fff;
      padding: 16px 24px;
      text-align: center;
      font-size: 14px;
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
        ${
          manual
            ? '<span>检测到页面内容已更新，请点击下方按钮立即刷新以加载最新版本。</span>'
            : `
        <svg style="animation: chunk-spin 1s linear infinite; width: 18px; height: 18px; flex-shrink: 0;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span style="flex-shrink: 0;">系统已更新，正在刷新页面加载最新版本...</span>
        `
        }
      </div>
      ${
        manual
          ? '<div style="margin-top: 12px;"><button type="button" id="chunk-manual-reload" style="border: 1px solid rgba(255,255,255,0.8); background: transparent; color: #fff; border-radius: 6px; padding: 6px 20px; font-size: 14px; cursor: pointer;">立即刷新</button></div>'
          : ''
      }
    </div>
  `

  const btn = bannerEl.querySelector<HTMLButtonElement>('#chunk-manual-reload')
  btn?.addEventListener('click', () => {
    hideBanner()
    forceReload()
  })

  document.body.appendChild(bannerEl)
}

function hideBanner() {
  if (!bannerEl) return
  bannerEl.remove()
  bannerEl = null
}

/**
 * 强制重新加载当前页面，绕过对旧 index.html 的缓存。
 *
 * 通过追加时间戳 query 参数走一次全新文档加载（新 cache key），
 * 尽量绕开浏览器对旧 index.html 的缓存，拿到本次构建的入口。
 * 用 replace 而非赋值/href：刷新不产生额外历史记录，避免用户按返回键又回到旧版本。
 *
 * 导出供错误边界页等场景复用——所有"刷新"统一走这里，避免各处拼 URL 分叉。
 * 注意：这只是前端尽力而为，真正要根治，服务端必须给 index.html
 * 配 Cache-Control: no-cache（hash 化 chunk 才能长缓存），否则刷新
 * 仍可能回到旧版本并再次触发 chunk 加载失败。
 */
export function forceReload() {
  const url = new URL(window.location.href)
  url.searchParams.set('_kim', Date.now().toString())
  window.location.replace(url.toString())
}

/**
 * 检测是否为 chunk 加载失败的错误
 *
 * 只匹配"模块 / 脚本动态加载"层面的信号，避免把接口 fetch 失败、普通 JS
 * 运行时异常误判成部署更新问题而触发整页刷新。各浏览器措辞不同：
 * Chrome: "Failed to fetch dynamically imported module: <url>"
 * Safari/iOS WebView: "Importing a module script failed." / 模块解析类报错
 * webpack 产物: "Loading chunk N failed" / ChunkLoadError
 */
export function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    error.message.includes('Loading chunk') ||
    error.message.includes('Loading CSS chunk') ||
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Unable to preload CSS') ||
    error.message.includes('Importing a module script failed') ||
    error.message.includes('Loading module script failed') ||
    error.message.includes('Failed to resolve module specifier') ||
    error.message.includes('Failed to load module') ||
    error.message.includes('imported module') ||
    error.message.includes('module script') ||
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

  const now = Date.now()
  const lastReload = localStorage.getItem(STORAGE_KEY)
  const withinCooldown = lastReload != null && now - parseInt(lastReload) < RELOAD_COOLDOWN

  // 冷却命中 / 已在处理中：不再静默等刷新，给用户一个可点击的手动刷新按钮，
  // 避免刷新未能逃出旧版本时反复失败、最终长时间白屏卡死。
  if (withinCooldown || isHandling) {
    console.warn('[ChunkHandler] 短时间内反复检测到 chunk 失败，请手动刷新')
    showBanner(true)
    return true
  }

  isHandling = true
  console.warn('[ChunkHandler] 检测到 chunk 加载失败，正在刷新页面...')
  localStorage.setItem(STORAGE_KEY, now.toString())

  showBanner(false)

  // 延迟刷新，让用户看到提示
  setTimeout(() => {
    hideBanner()
    forceReload()
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
  forceReload,
}