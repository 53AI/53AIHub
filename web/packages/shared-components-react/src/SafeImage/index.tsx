/**
 * 通用图片组件 — 跨 app 唯一展示图片的方式
 *
 * 新增图片展示需求必须用本组件，禁止：
 * - 直接使用 `<img src={url}>` 展示任何图片
 * - 在调用处手写 `onError={(e) => { e.currentTarget.src = '...' }}` 兜底
 *
 * 缺省保护，避免裂图：
 * 1. 传入 src 为空/纯空白 → 走默认 fallback
 * 2. 加载失败（404 / 网络错误）→ 先带 cache-busting nonce 重试 `maxRetries` 次
 * 3. 重试耗尽仍失败 → 走默认 fallback
 * 4. fallback 本身也加载失败时由浏览器展示 alt，不在此处再兜
 *
 * 重试是有界的（最多 maxRetries 次），不会死循环；nonce 用于绕过浏览器对失败 URL
 * 的缓存，让重试真正发出新请求。失败次数随 src 变化重置。
 *
 * src 变化时自动重试：父组件更新 src 后 useEffect 会清掉 errored/attempt，新 src 重新尝试加载。
 * onLoad 不重置 errored：fallback 加载成功会触发 onLoad，若清掉状态会回到原 src 形成
 * 「src → onError → fallback → onLoad → src → onError」死循环。
 *
 * 命名说明：叫 `SafeImage` 而非 `Image`，是为了和 antd `Image` 区分（antd Image 有
 * preview 缩放功能，业务上常与本组件共存，避免调用方反复 import 别名）。
 *
 * 路径解析：本地资源（以 `/` 开头）走 `window.$getPublicPath` 拼接 base，
 * 远程 URL（`http://` / `https://`）原样使用。
 */
import { forwardRef, useEffect, useState, type ImgHTMLAttributes } from 'react'

const DEFAULT_FALLBACK_PATH = '/images/default_agent.png'
const DEFAULT_MAX_RETRIES = 2

const resolveUrl = (input: string): string => {
  if (!input) return input
  if (/^https?:\/\//i.test(input)) return input
  const base = (window as any).$getPublicPath?.('') || '/'
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const normalizedPath = input.startsWith('/') ? input : `/${input}`
  return `${normalizedBase}${normalizedPath}`
}

/** 给 URL 追加 cache-busting nonce，绕过浏览器对失败 URL 的缓存，强制重新请求 */
const withRetryNonce = (url: string, attempt: number): string => {
  const [base, hash] = url.split('#')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}retry=${attempt}${hash ? `#${hash}` : ''}`
}

export type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  /** 图片 URL；空串或纯空白视作缺省 */
  src: string
  /** 自定义兜底图 URL；默认 `/images/default_agent.png`（merge-public 插件跨 app 提供） */
  fallback?: string
  /** 禁用兜底，失败时由浏览器展示 alt（特殊场景，默认 false） */
  disableFallback?: boolean
  /** 单个 src 加载失败后的重试次数，默认 2；重试耗尽仍未加载成功则固定渲染 fallback */
  maxRetries?: number
}

export const SafeImage = forwardRef<HTMLImageElement, SafeImageProps>(function SafeImage(
  {
    src,
    fallback,
    disableFallback = false,
    maxRetries = DEFAULT_MAX_RETRIES,
    alt = '',
    onLoad,
    ...rest
  },
  ref,
) {
  const [attempt, setAttempt] = useState(0)
  const [errored, setErrored] = useState(false)

  // src 变化时重置重试状态：父组件主动给了新 URL，值得重新尝试。
  // 不要在 onLoad 里清 errored：fallback 加载成功会触发 onLoad，会形成 src→fallback 死循环。
  useEffect(() => {
    setAttempt(0)
    setErrored(false)
  }, [src])

  const showFallback = !disableFallback && (errored || !src?.trim())
  const resolved = showFallback
    ? resolveUrl(fallback ?? DEFAULT_FALLBACK_PATH)
    : attempt > 0
      ? withRetryNonce(resolveUrl(src), attempt)
      : resolveUrl(src)

  return (
    <img
      ref={ref}
      src={resolved}
      alt={alt}
      onLoad={onLoad}
      onError={() => {
        // 已在 fallback 上时不再重试：兜底图失败是终态，防止无谓的 onError 抖动
        if (showFallback) return
        // 有界重试：未超限则带 nonce 重新请求原 src；超限则固定渲染 fallback
        if (attempt < maxRetries) {
          setAttempt((a) => a + 1)
        } else {
          setErrored(true)
        }
      }}
      {...rest}
    />
  )
})

export default SafeImage
