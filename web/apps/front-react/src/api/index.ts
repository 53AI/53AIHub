import service, { get, post, put, del, patch } from './config'

// 导出请求实例和方法
export { service, get, post, put, del, patch }

// 导出配置
export { API_HOST, ADMIN_URL, IMG_HOST, LIB_HOST } from './host'

// 导出响应码
export {
  RESPONSE_CODE,
  RESPONSE_STATUS,
  ResponseMessage,
  RESPONSE_CODE_MESSAGE_MAP,
  ERROR_MESSAGES,
  RESPONSE_MESSAGE_MAP,
  RESPONSE_DATA_MESSAGE_MAP,
} from './code'
export type { ResponseCode, ResponseStatus } from './code'

// 导出错误处理
export { handleError, clearMessageCache } from './errorHandler'

// 导出签名工具
export { generateSignParams, generateIbosSignParams } from './signature'

// 导出类型
export type { BaseResponse } from './types'

// 导出模块
export * from './modules/common'
export * from './modules/user'
export * from './modules/auth'
export * from './modules/env-config'
export * from './modules/graph-templates'

// 默认导出请求实例
export default service
