import service from '../config'

/** GET /api/env-config 返回的 data 结构 */
export type EnvConfigData = {
  api_host?: string
  kk_base_url?: string
}

/** GET /api/env-config 响应体 */
export type EnvConfigResponse = {
  code: number
  data: EnvConfigData
  message: string
}

/**
 * 获取环境变量配置（api_host、kk_base_url）
 * 用于应用启动时注入 window，供 config 按需读取
 */
export const getEnvConfig = (): Promise<EnvConfigResponse> => {
  return service.get<EnvConfigResponse>('/api/env-config')
}

export const envConfigApi = {
  getEnvConfig,
}

export default envConfigApi
