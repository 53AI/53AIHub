import { useEffect, useRef } from 'react'

/**
 * 部署版本自愈：轮询 version.txt，检测到新版本自动 reload。
 *
 * 背景：SPA 部署后 HTML 入口可能被浏览器/中间层缓存，用户拿旧 HTML 引用
 * 已被清理的旧 chunk → 白屏/报错，需强刷（Ctrl+F5）才能恢复。
 * version.txt 由构建时 versionPlugin 写入（vite.config.ts），内容变 = 新部署。
 *
 * 行为：
 *   - 每 5 分钟轮询 + 页面从后台切回前台时立即检测（用户回来时最快感知）
 *   - 版本变化 → location.reload()（用户无感更新；录音中由调用方决定是否启用）
 *   - 请求带时间戳 query 防轮询自身被缓存
 *   - 任何失败静默（下轮再试），永不影响业务
 *
 * 注意：录音中自动 reload 会丢录音——本 hook 默认不启用轮询期间的录音保护，
 * 调用方（App）传 shouldSkip 判断（如录音 store 状态）。
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000

export function useVersionReload(shouldSkip?: () => boolean): void {
  const versionRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const check = async (): Promise<void> => {
      try {
        // BASE_URL 拼接（勿用裸相对路径）：history 路由子路径页面下
        // fetch('version.txt') 会解析为 /recording/preview/version.txt 而 404，
        // 基线永远是 null（实测踩坑）。BASE_URL：web='/'，hash/desktop='./'
        // （'./' 相对文档 URL，hash 模式文档不变，正确）
        const base = import.meta.env.BASE_URL
        const url = `${base}version.txt?t=${Date.now()}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const text = (await res.text()).trim()
        if (!text) return
        if (versionRef.current === null) {
          // 首次：记录基线（部署后首访不算「有新版本」）
          versionRef.current = text
          return
        }
        if (text !== versionRef.current) {
          if (shouldSkip?.()) {
            // 录音中等场景：本轮跳过，下轮再试（版本已更新，基线不刷新）
            return
          }
          console.info(`[version] 检测到新版本 ${text}（当前 ${versionRef.current}），自动刷新`)
          location.reload()
        }
      } catch {
        // 网络失败静默，下轮再试
      }
    }

    const timer = setInterval(() => void check(), POLL_INTERVAL_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !cancelled) void check()
    }
    document.addEventListener('visibilitychange', onVisible)

    void check() // 挂载即取基线

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [shouldSkip])
}
