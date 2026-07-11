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
