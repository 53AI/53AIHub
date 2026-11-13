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
/** 安心录 Flutter Web 站点地址（安心录右侧 375px iframe 面板加载；测试环境为本机 flutter run 端口） */
export const record_flutter_url = formatUrl(getConfigValue('record_flutter_url', 'VITE_GLOB_RECORD_FLUTTER_URL', '/meetingplugin/index.html'))
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

/**
 * 端侧 ASR 模型基址（silero-vad / zipformer / paraformer / wespeaker）。
 * 模型不入 git（~256MB），三种部署方式：
 *   1. OSS/CDN（SaaS 默认）：DEFAULT_ASR_MODELS_BASE_URL 指向 OSS，
 *      模型不随 dist 部署（省 256MB 传输与构建下载耗时）
 *   2. 同源 public（私有化/无外网）：.env 里配 VITE_ASR_MODELS_BASE_URL=/models，
 *      并在构建前跑 scripts/download-asr-models.mjs
 *   3. 线上关闭：localStorage km-live-transcript-disabled=1
 * 优先级：window 全局 > URL 参数 > 构建时 env > 本处默认值
 *
 * 为什么默认值放这里而不是 boot.js：getConfigValue 里 window 优先级最高，
 * 若在 boot.js 无条件写 window.asr_models_base_url，会盖掉私有化部署的
 * VITE_ASR_MODELS_BASE_URL 配置。放这里当 defaultValue 才能被 env 覆盖。
 */
const DEFAULT_ASR_MODELS_BASE_URL = 'https://oss.ibos.cn/common/agenthub/models'

export const asr_models_base_url = formatUrl(
  getConfigValue(
    'asr_models_base_url',
    'VITE_ASR_MODELS_BASE_URL',
    isPrivatePrem || isOpLocalEnv ? getPublicPath('models') : DEFAULT_ASR_MODELS_BASE_URL
  )
)
