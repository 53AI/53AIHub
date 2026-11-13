import { record_flutter_url, api_host } from '@/utils/config'
import { useUserStore } from '@/stores/modules/user'

/**
 * 前台 → Flutter Web 的嵌入交接参数。
 *
 * iframe 与主站不同源、不共享任何存储，打开面板时把当前环境的登录态与
 * 后端地址随 URL 传给 Flutter，由其启动时写入自己的持久化：
 * - `km_token` / `km_user_id`：登录态，免登录直接进入对应页面；
 * - `km_api_host`：当前环境的后端 API 地址——前台有多个测试环境、各环境
 *   api 地址不同，Flutter 侧据此对齐宿主环境的后端，一套 Flutter 构建
 *   适配所有环境，不需要按环境各编译一份。
 *
 * 参数落在 hash 段（#/...?km_token=...），浏览器不会把 hash 发往服务端，
 * 也不进服务端访问日志。
 */
const getEmbedHandoffParams = (): Record<string, string> => {
  const { info } = useUserStore.getState()
  const token = info.access_token || localStorage.getItem('access_token') || ''
  return {
    ...(token ? { km_token: token, km_user_id: String(info.user_id ?? '') } : {}),
    km_api_host: api_host,
  }
}

/**
 * 拼接安心录 Flutter Web 站点（KM-Record）的完整 URL。
 *
 * Flutter Web 未启用 PathUrlStrategy（默认 HashUrlStrategy），路由落在
 * URL hash 段，形如 `http://host/#/business/memory/1?type=person`；
 * 查询参数同样拼在 hash 内（go_router 从 hash 中解析 queryParameters）。
 *
 * @param path 站内路由路径，以 / 开头（如 /business/memory/add）
 * @param params 查询参数；值为 undefined / null / 空串时自动忽略
 */
export const buildFlutterWebUrl = (
  path: string,
  params?: Record<string, string | number | undefined | null>,
): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const search = new URLSearchParams(
    Object.entries({ ...getEmbedHandoffParams(), ...(params ?? {}) })
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString()
  return `${record_flutter_url}#${normalizedPath}${search ? `?${search}` : ''}`
}
