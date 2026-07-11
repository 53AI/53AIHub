/**
 * 格式化URL，确保返回完整的URL
 * @param url 需要格式化的URL
 * @returns 格式化后的完整URL
 */
const formatUrl = (url: string = ''): string => {
  const { origin } = window.location
  let formattedUrl = ''
  // 如果已经是完整的URL，直接返回
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
    formattedUrl = url
  } else if (url.startsWith('/')) {
    formattedUrl = origin + url
  } else if (/^[\w.-]+(?::\d+)?(?:\/.*)?$/.test(url)) {
    formattedUrl = `http://${url}`
  } else {
    formattedUrl = origin + url
  }

  // 删掉最后的/
  return formattedUrl.replace(/\/$/, '')
}

/**
 * 获取环境变量或window对象中的值
 * @param windowKey window对象中的键名
 * @param envKey 环境变量键名
 * @param defaultValue 默认值
 * @returns 配置值
 */
const getConfigValue = (
  windowKey: string,
  envKey: string,
  defaultValue: string = ''
): string => {
  const searchValue = new URLSearchParams(window.location.search).get(windowKey)
  return (window as any)[windowKey] || searchValue || import.meta.env[envKey] || defaultValue
}



// @ts-ignore
export const api_host = formatUrl(getConfigValue('api_host', 'VITE_GLOB_API_HOST', window.location.origin))
export const admin_url = getConfigValue('admin_url', 'VITE_GLOB_ADMIN_URL', '/console')
/** 构建时或 .env 中的默认值，运行时会被后端 env-config 覆盖 */
export const kkfileview_url = getConfigValue('kkfileview_url', 'VITE_GLOB_KKFILEVIEW_URL', '')
/** 按需读取 kkfileview 地址（优先使用后端 env-config 返回的 kk_base_url） */
export const getKkfileviewUrl = (): string =>
  getConfigValue('kkfileview_url', 'VITE_GLOB_KKFILEVIEW_URL', '')
export const official_id = getConfigValue('official_id', 'VITE_GLOB_OFFICIALID', '53ai')
export const suite_id = getConfigValue('suite_id', 'VITE_GLOB_SUITEID', '53ai')
export const auth_key = getConfigValue('auth_key', 'VITE_GLOB_AUTH_KEY', '53ai')
export const isOpLocalEnv = true
export const isPrivatePrem: boolean =
  getConfigValue('isPrivatePrem', 'VITE_PRIVATE_PREM', 'false') === 'true'

export const img_host = `${api_host}/api/images`
export const lib_host = `${api_host}/api/libs`

/**
 * 获取公共资源路径
 * @param path 资源路径
 * @returns 完整的公共资源路径
 */
export const getPublicPath = (path: string): string => {
  const base = (window as any).$getPublicPath?.('') || '/'
  return base + path.replace(/^\//, '')
}
