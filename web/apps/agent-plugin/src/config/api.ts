/**
 * 格式化URL，确保返回完整的URL
 */
const formatUrl = (url: string = ''): string => {
  const { origin } = window.location
  let formattedUrl = ''
  if (url.startsWith('http')) {
    formattedUrl = url
  } else {
    formattedUrl = origin + url
  }
  return formattedUrl.replace(/\/$/, '')
}

/**
 * 获取环境变量或window对象中的值
 */
const getConfigValue = (
  windowKey: string,
  envKey: string,
  defaultValue: string = ''
): string => {
  return (window as any)[windowKey] || import.meta.env[envKey] || defaultValue
}

export const api_host = formatUrl(
  getConfigValue('api_host', 'VITE_GLOB_API_HOST', window.location.origin)
)

export const auth_key = getConfigValue('auth_key', 'VITE_GLOB_AUTH_KEY', '53ai')