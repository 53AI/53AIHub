/**
 * 通用图片组件 — 跨 app 唯一展示图片的方式
 *
 * 新增图片展示需求必须用本组件，禁止：
 * - 直接使用 `<img src={url}>` 展示任何图片
 * - 在调用处手写 `onError={(e) => { e.currentTarget.src = '...' }}` 兜底
 *
 * 缺省保护，避免裂图：
 * 1. 传入 src 为空/纯空白 → 走默认 fallback
 * 2. **离屏 Image 探针**：先在内存里解码原 src；解码成功前渲染轻量 loading 占位，
 *    成功后把真实 `<img>` 顶上可见层。可见层任何时刻都不会挂载一个失败中的 URL，
 *    因此从根上杜绝破图闪烁。
 * 3. 探针失败（404 / 网络错误）→ 内部带 cache-busting nonce 静默重试 `maxRetries` 次
 *    （此间可见层仍是 loading 占位）；任一成功 → 用该 success 的 URL 渲染真实图；
 *    全部耗尽 → 固定渲染默认 fallback / 字母头像。
 * 4. fallback 本身也加载失败时由浏览器展示 alt，不在此处再兜。
 *
 * 重试是有界的（最多 maxRetries 次），不会死循环；nonce 用于绕过浏览器对失败 URL
 * 的缓存，让重试真正发出新请求。失败状态随 src 变化重置。
 *
 * src 变化时自动重试：父组件更新 src 后 useEffect 清掉 readySrc/failed，新 src 重新探针加载。
 *
 * 字母头像模式（`letter`）：当 src 缺省或加载失败后，若传了 `letter` 则渲染首字母头像
 * （替代默认兜底图），用于无真实图片的占位头像。字母分支渲染的是 `<div>` 而非 `<img>`。
 *
 * 尺寸约定：本组件不做内联尺寸约束，宽高统一由调用方 className 控制（如 `size-[40px]`、
 * `w-8 h-8`）；所有渲染分支（占位 / 真实图 / 兜底 / 字母头像）都透传 className，保证各分支
 * 尺寸一致、不跳变。字母头像的字体大小同样由调用方 className 顶（如 `text-sm`）。
 *
 * 命名说明：叫 `SafeImage` 而非 `Image`，是为了和 antd `Image` 区分（antd Image 有
 * preview 缩放功能，业务上常与本组件共存，避免调用方反复 import 别名）。
 *
 * 路径解析：本地资源（以 `/` 开头）走 `window.$getPublicPath` 拼接 base，
 * 远程 URL（`http://` / `https://`）原样使用。
 */
import { forwardRef, useEffect, useState, type ImgHTMLAttributes } from 'react'

const DEFAULT_FALLBACK_PATH = '/images/default_agent.png'
const DEFAULT_MAX_RETRIES = 1

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

const toPx = (v: string | number): string => (typeof v === 'number' ? `${v}px` : v)

export type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  /** 图片 URL；空串或纯空白视作缺省 */
  src: string
  /** 自定义兜底图 URL；默认 `/images/default_agent.png`（merge-public 插件跨 app 提供） */
  fallback?: string
  /** 禁用兜底，失败时由浏览器展示 alt（特殊场景，默认 false） */
  disableFallback?: boolean
  /** 单个 src 加载失败后的重试次数，默认 2；重试耗尽仍未加载成功则固定渲染 fallback */
  maxRetries?: number

  /** 兜底字母头像文字；提供时在 src 缺省/加载失败后渲染首字母头像，否则渲染默认兜底图 */
  letter?: string
  /** 字母头像文字颜色，默认 #07C160 */
  textColor?: string
  /** 字母头像背景色，默认 #FCFFFE */
  backgroundColor?: string
  /** 字母头像圆角，默认 4 */
  round?: number | string
  /** 字母头像是否显示边框，默认 true */
  border?: boolean
  /** 字母头像边框颜色，默认 #07C160 */
  borderColor?: string
}

export const SafeImage = forwardRef<HTMLImageElement, SafeImageProps>(function SafeImage(
  {
    src,
    fallback,
    disableFallback = false,
    maxRetries = DEFAULT_MAX_RETRIES,
    alt = '',
    letter,
    textColor,
    backgroundColor,
    round,
    border,
    borderColor,
    style: customStyle,
    onLoad,
    ...rest
  },
  ref,
) {
  // 真实图加载状态：readySrc 非空 = 该 URL 已用离屏 Image 探针解码成功，可直接渲染；
  // failed = 重试耗尽，固定渲染兜底。
  const [readySrc, setReadySrc] = useState('')
  const [failed, setFailed] = useState(false)

  // src 变化时重置加载状态：父组件主动给了新 URL，值得重新尝试
  useEffect(() => {
    setReadySrc('')
    setFailed(false)
  }, [src])

  const roundCss = round != null ? toPx(round) : '4px'

  const trimmedLetter = (letter ?? '').trim()
  const firstChar = trimmedLetter ? Array.from(trimmedLetter)[0] : ''
  const letterChar =
    firstChar && /[a-zA-Z]/.test(firstChar) ? firstChar.toUpperCase() : firstChar

  const emptySrc = !src?.trim()

  // 离屏 Image 探针：先在内存里验证 URL 能否解码成功，成功后才把真实 <img> 顶上可见层，
  // 从根上避免「可见层加载失败 URL」导致的破图闪烁。重试在探针内部带 nonce 静默步进，
  // 可见层在此期间保持 loading 占位。
  useEffect(() => {
    if (emptySrc) return
    let cancelled = false
    let step = 0 // 0=原始 src，>0=第 N 次带 nonce 的重试
    const tryLoad = () => {
      const probe = new Image()
      const url = step > 0 ? withRetryNonce(resolveUrl(src), step) : resolveUrl(src)
      probe.onload = () => {
        if (cancelled) return
        setReadySrc(url) // 复用该 success 的 URL；浏览器已缓存，切到可见 <img> 即时显示、无闪烁
      }
      probe.onerror = () => {
        if (cancelled) return
        if (step < maxRetries) {
          step += 1
          tryLoad()
        } else {
          setFailed(true)
        }
      }
      probe.src = url
    }
    tryLoad()
    return () => {
      cancelled = true
    }
  }, [src, maxRetries, emptySrc])

  const imgStyle = {
    ...(round != null ? { borderRadius: roundCss } : null),
    ...customStyle,
  }

  // 字母头像：src 缺省或重试耗尽时展示（替代默认兜底图）。渲染 div 而非 img，不起可加载元素
  const showLetterAvatar = !disableFallback && !!letterChar && (emptySrc || failed)
  if (showLetterAvatar) {
    return (
      <div
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          flex: 'none',
          userSelect: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          textTransform: 'uppercase',
          lineHeight: 1,
          boxSizing: 'border-box',
          backgroundColor: backgroundColor ?? '#FCFFFE',
          color: textColor ?? '#07C160',
          borderRadius: roundCss,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: border !== false ? (borderColor ?? '#07C160') : 'transparent',
          ...customStyle,
        }}
        {...rest}
      >
        {letterChar}
      </div>
    )
  }

  // 无 src：直接渲染默认兜底图（disableFallback 时给空 src，由浏览器展示 alt）
  // onLoad 沿用原语义：兜底图也算「渲染出了图」，照常回传
  if (emptySrc) {
    const fallbackResolved = disableFallback
      ? ''
      : resolveUrl(fallback ?? DEFAULT_FALLBACK_PATH)
    return <img ref={ref} src={fallbackResolved} alt={alt} onLoad={onLoad} style={imgStyle} {...rest} />
  }

  // 加载中：探针尚未解码完成，渲染轻量占位（尺寸与真实图一致，避免布局抖动）。
  // 想换成 spinner / 骨架屏，改这里即可。
  if (!readySrc && !failed) {
    return (
      <div
        aria-hidden="true"
        style={{
          borderRadius: roundCss,
          background: 'rgba(120,120,128,0.12)',
          ...customStyle,
        }}
        {...rest}
      />
    )
  }

  // 已就绪：渲染已被探针验证过的 URL（同源缓存，即时显示）
  if (readySrc) {
    return <img ref={ref} src={readySrc} alt={alt} onLoad={onLoad} style={imgStyle} {...rest} />
  }

  // 重试耗尽：渲染兜底图；若禁用兜底，回落到原始 src（由浏览器展示 alt/破图）
  const fs = disableFallback ? resolveUrl(src) : resolveUrl(fallback ?? DEFAULT_FALLBACK_PATH)
  return <img ref={ref} src={fs} alt={alt} onLoad={onLoad} style={imgStyle} {...rest} />
})

export default SafeImage