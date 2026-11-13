export const isUrl = (str: string): boolean => {
  try {
    const url = new URL(str)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 将 URL 与查询参数字符串拼接
 */
export const joinUrl = (url: string, paramStr: string): string => {
  if (typeof url !== 'string') return ''
  return url + (url.includes('?') ? '&' : '?') + paramStr
}

/**
 * 解析静态资源地址（唯一实现，SafeImage / chat 组件共用）：
 * - 绝对 URL（http(s)/data:/blob: 等带 scheme 的）原样返回
 * - 其余（/images/x.png 或相对路径）用 window.$getPublicPath 拼接站点 base
 *   （front 恒等、console 为 /console；未设置时兜底 '/'）
 */
export const resolveAssetUrl = (input?: string): string => {
  if (!input) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input
  if (typeof window === 'undefined') return input
  const base = (window as any).$getPublicPath?.('') || '/'
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const normalizedPath = input.startsWith('/') ? input : `/${input}`
  return `${normalizedBase}${normalizedPath}`
}

/**
 * 判断当前是否在内网环境（依赖 window.location，仅浏览器可用）
 */
export const isInternalNetwork = (): boolean => {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    return true
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split('.').map(Number)
    if (parts.some((p) => p < 0 || p > 255)) return false
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    )
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const ip = hostname.slice(1, -1)
    return (
      ip === 'fc00:' || ip === 'fd00:' || ip.startsWith('fe80:')
    )
  }
  return /\.(local|lan|intranet|internal|priv)$/i.test(hostname)
}
