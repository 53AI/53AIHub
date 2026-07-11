import axios, { type AxiosResponse, type AxiosRequestConfig, type AxiosProgressEvent } from 'axios'

import { generateSignParams, generateIbosSignParams } from './signature'
import { RESPONSE_CODE, RESPONSE_STATUS } from './code'
import { API_HOST } from './host'

// 定义重试配置接口
interface RetryConfig {
  retry: number
  retryDelay: number
  count?: number
}

// 流式数据解析后的回调参数
export interface StreamProgressData {
  progressEvent: AxiosProgressEvent
  chunks: any[]
  intact_content: string
  intact_reasoning_content: string
}

// 扩展 AxiosRequestConfig 类型
declare module 'axios' {
  export interface AxiosRequestConfig {
    // 重试配置
    retryConfig?: RetryConfig
    // ibos签名
    ibos_sign?: boolean
    // 手机号签名
    code_sign?: boolean
    // 需要身份验证
    requiresAuth?: boolean
    // 是否流式响应（自动解析 SSE 数据）
    isStream?: boolean
  }
}

const service = axios.create({
  baseURL: API_HOST
})

// 默认重试配置
const defaultRetryConfig: RetryConfig = {
  count: 1,
  retry: 3, // 最大重试次数
  retryDelay: 1000 // 重试延迟时间（毫秒）
}

service.interceptors.request.use(
  (config) => {
    if ((config.responseType as string | undefined) === 'stream' && typeof XMLHttpRequest !== 'undefined') {
      config.responseType = 'text'
    }

    const params = config.params || {}
    const access_token = params.access_token || localStorage.getItem('access_token') || ''
    if (access_token) config.headers.set('Authorization', `Bearer ${access_token}`)

    // 如果需要身份验证，但没有token，则返回200, code 返回特定的1000
    if (config.requiresAuth && !access_token) {
      const error = new Error('Authentication required')
      ;(error as any).response = {
        status: RESPONSE_STATUS.SUCCESS,
        data: {
          code: RESPONSE_CODE.UNAUTHORIZED_INTERCEPTED,
          message: 'Authentication required'
        }
      }
      return Promise.reject(error)
    }

    if (config.ibos_sign) {
      const { token, platform, createtime } = generateIbosSignParams()
      config.headers.set('token', token)
      config.headers.set('platform', platform)
      config.headers.set('createtime', createtime)
    }

    // 处理 isStream: 包装 onDownloadProgress 以自动解析 SSE 数据
    if (config.isStream && config.onDownloadProgress) {
      const origin_onDownloadProgress = config.onDownloadProgress as unknown as (data: StreamProgressData) => void
      config.onDownloadProgress = (progressEvent: AxiosProgressEvent) => {
        const { event: { target: { responseText = '' } = {} } = {} } = progressEvent as any
        let chunks: any[] = []
        let intact_content = ''
        let intact_reasoning_content = ''
        if (responseText) {
          chunks = responseText
            .split(/data\:\s*/g)
            .filter((text: string) => text)
            .map((text: string) => {
              try {
                // 找到最后一个完整的JSON对象
                const lastIndex = text.lastIndexOf('}')
                if (lastIndex !== -1) {
                  const chunk = text.slice(0, lastIndex + 1)
                  return JSON.parse(chunk)
                }
                return null
              } catch (error) {
                console.log(text, error)
                return null
              }
            })
            .filter((item: any) => item)
            .map((item: any = {}) => {
              const { delta = {} } = (item.choices || [])[0] || {}
              item.content_id = item.content_id || item.id || delta.content_id || delta.id || ''
              item.content = delta.content || ''
              item.reasoning_content = delta.reasoning_content || ''
              item.role = delta.role || ''
              intact_content += item.content
              intact_reasoning_content += item.reasoning_content
              item.intact_content = intact_content
              item.intact_reasoning_content = intact_reasoning_content
              return item
            })
        }
        origin_onDownloadProgress({ progressEvent, chunks, intact_content, intact_reasoning_content })
      }
    }

    return {
      ...config,
      params: config.code_sign ? generateSignParams(params) : params,
      retryConfig: {
        ...defaultRetryConfig,
        ...(config.retryConfig || {})
      }
    }
  },
  (error) => {
    return Promise.reject(error.response)
  }
)

service.interceptors.response.use(
  (response: AxiosResponse): any => {
    const data = response.data || {}
    if ([RESPONSE_CODE.FORBIDDEN_ERROR as number].includes(Number(data.code))) {
      return Promise.reject(data)
    }
    if ([200, 201, 204].includes(response.status)) return response.data
    throw new Error(response.status.toString())
  },
  async (error) => {
    const { config } = error

    // 如果没有重试配置，直接拒绝
    if (!config || !config.retryConfig) {
      return Promise.reject(error)
    }

    // 判断是否应该重试
    const shouldRetry = () => {
      // 网络错误（没有响应）
      if (!error.response) {
        return true
      }

      const { status } = error.response

      // 只对以下状态码进行重试：
      // - 5xx 服务器错误
      // - 408 请求超时
      if (status >= 500 || status === 408) {
        return true
      }

      // 4xx 客户端错误不重试（除了上面的特殊情况）
      return false
    }

    // 如果不应该重试，直接拒绝
    if (!shouldRetry()) {
      return Promise.reject(error)
    }

    const { retry, retryDelay, count = 1 } = config.retryConfig

    // 如果已经达到最大重试次数，拒绝请求
    if (count >= retry) {
      return Promise.reject(error)
    }

    // 增加重试计数
    config.retryConfig.count = count + 1

    // 延迟重试
    await new Promise((resolve) => {
      setTimeout(resolve, retryDelay)
    })

    // 重试请求
    return service(config)
  }
)

// 封装通用请求方法
function request<T = any>(config: AxiosRequestConfig): Promise<T> {
  return service(config).then((res) => res.data)
}

// 导出常用HTTP方法
export const get = <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'get', url })
}

export const post = <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'post', url, data })
}

export const put = <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'put', url, data })
}

export const del = <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'delete', url })
}

export const patch = <T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> => {
  return request({ ...config, method: 'patch', url, data })
}

export default service
