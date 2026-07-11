const formatUrl = (url: string = ''): string => {
  const { origin } = window.location
  const trimmedUrl = decodeURIComponent(url.trim())

  if (!trimmedUrl) return origin.replace(/\/$/, '')
  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl.replace(/\/$/, '')
  if (trimmedUrl.startsWith('//')) {
    return `${window.location.protocol}${trimmedUrl}`.replace(/\/$/, '')
  }
  if (trimmedUrl.startsWith('/')) return `${origin}${trimmedUrl}`.replace(/\/$/, '')

  return `${window.location.protocol}//${trimmedUrl}`.replace(/\/$/, '')
}

const getConfigValue = (windowKey: string, envKey: string, defaultValue: string = ''): string => {
  return ((window as any)[windowKey] as string) || ((import.meta.env as any)[envKey] as string) || defaultValue
}

export const pathname = '/api'

export const api_host: string = formatUrl(
  getConfigValue('api_host', 'VITE_GLOB_API_HOST', window.location.origin),
)

export const base_path: string = getConfigValue('base_path', 'VITE_BASE_PATH', '/console-react')

export const suite_id: string = getConfigValue('suite_id', 'VITE_GLOB_SUITEID', '53ai')

export const official_id: string = getConfigValue('official_id', 'VITE_GLOB_OFFICIALID', '53ai')

export const domain_suffix: string = getConfigValue(
  'domain_suffix',
  'VITE_DOMAIN_SUFFIX',
  'km.53ai.com',
)

export const includeKm: boolean = getConfigValue('includeKm', 'VITE_INCLUDE_KM', 'false') === 'true'

export const img_host = `${api_host}/api/images`
export const lib_host = `${api_host}/api/libs`

export const isOpLocal: boolean = true

export const isPrivatePrem: boolean =
  getConfigValue('isPrivatePrem', 'VITE_PRIVATE_PREM', 'false') === 'true'

/** KKFileView 预览服务地址 */
export const getKkfileviewUrl = (): string =>
  getConfigValue('kkfileview_url', 'VITE_GLOB_KKFILEVIEW_URL', '')

/**
 * 获取真实路径，添加 base_path 前缀
 * @param url 需要处理的 URL
 * @returns 处理后的完整路径
 */
export const getRealPath = (url: string = ''): string => {
  if (!url) return base_path
  if (/^https?:\/\//i.test(url)) return url
  const base = base_path.replace(/\/$/, '')
  const u = url.startsWith('/') ? url : `/${url}`
  return `${base}${u}`
}

/**
 * 获取公共资源路径
 * @param path 资源路径
 * @returns 完整的公共资源路径
 */
export const getPublicPath = (path: string): string => {
  const base = (window as any).$getPublicPath?.('') || '/'
  return base + '/' + path.replace(/^\//, '')
}
