import axios, { type AxiosRequestConfig, type AxiosResponse, type AxiosProgressEvent } from 'axios'
import { RESPONSE_CODE, RESPONSE_STATUS } from './code'
import { generateIbosSignParams, generateSignParams } from './signature'

import { api_host } from '@/utils/config'

interface RetryConfig {
  retry: number
  retryDelay: number
  count?: number
}

declare module 'axios' {
  export interface AxiosRequestConfig {
    retryConfig?: RetryConfig
    ibos_sign?: boolean
    code_sign?: boolean
    requiresAuth?: boolean
    responseType?: 'json' | 'blob' | 'text' | 'stream'
    isStream?: boolean
  }
}

export const service = axios.create({
  baseURL: api_host,
})

const defaultRetryConfig: RetryConfig = {
  count: 1,
  retry: 3,
  retryDelay: 1000,
}

// 解析流式响应
// 与 front-react/src/api/config.ts 对齐：回调参数中附带原始 progressEvent，
// 供调用方（例如 useChatStream.processStreamData）按 e.event.target.response 二次解析。
const parseStreamResponse = (
  progressEvent: AxiosProgressEvent,
  originalCallback?: (data: {
    progressEvent: AxiosProgressEvent
    chunks: any[]
    intact_content: string
    intact_reasoning_content: string
  }) => void
) => {
  const responseText = (progressEvent as any)?.event?.target?.responseText || ''
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

  if (originalCallback) {
    originalCallback({ progressEvent, chunks, intact_content, intact_reasoning_content })
  }
}

service.interceptors.request.use(
  config => {
    config.params = config.params || {}

    const access_token = config.params.access_token || localStorage.getItem('access_token') || ''
    if (access_token) config.headers.set('Authorization', `Bearer ${access_token}`)

    if (config.requiresAuth && !access_token) {
      const error = new Error('Authentication required')
      ;(error as any).response = {
        status: RESPONSE_STATUS.SUCCESS,
        data: {
          code: RESPONSE_CODE.UNAUTHORIZED_INTERCEPTED,
          message: 'Authentication required',
        },
      }
      return Promise.reject(error)
    }

    if (config.ibos_sign) {
      const { token, platform, createtime } = generateIbosSignParams()
      config.headers.set('token', token)
      config.headers.set('platform', platform)
      config.headers.set('createtime', createtime)
    }
    if (config.code_sign) config.params = generateSignParams(config.params)

    config.retryConfig = {
      ...defaultRetryConfig,
      ...(config.retryConfig || {}),
    }

    // 处理流式响应
    if ((config as any).isStream && config.onDownloadProgress) {
      const originalCallback = config.onDownloadProgress as any
      config.onDownloadProgress = (progressEvent: AxiosProgressEvent) => {
        parseStreamResponse(progressEvent, originalCallback)
      }
    }

    return config
  },
  error => {
    return Promise.reject(error.response)
  },
)

service.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    // 流式响应直接返回，不需要处理响应体
    if ((response.config as any).isStream) {
      return response
    }
    if ([200, 201, 204].includes(response.status)) return response.data
    throw new Error(response.status.toString())
  },
  async error => {
    const { config } = error
    if (!config || !config.retryConfig) return Promise.reject(error)

    const shouldRetry = () => {
      if (!error.response) return true
      const { status } = error.response
      if (status >= 500 || status === 408) return true
      return false
    }

    if (!shouldRetry()) return Promise.reject(error)

    const { retry, retryDelay, count = 1 } = config.retryConfig
    if (count >= retry) return Promise.reject(error)

    config.retryConfig.count = count + 1
    await new Promise(resolve => setTimeout(resolve, retryDelay))

    return service(config)
  },
)

function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  return service(config).then(res => res.data)
}

export const get = <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'get', url })
}

export const post = <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'post', url, data })
}

export const put = <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'put', url, data })
}

export const del = <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'delete', url })
}

export const patch = <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'patch', url, data })
}

export default service

