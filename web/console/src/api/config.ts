import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { generateIbosSignParams, generateSignParams } from './signature'
import { api_host } from '@/utils/config'

const service = axios.create({
  baseURL: api_host,
})

service.interceptors.request.use(
  (config) => {
    config.params = config.params || {}
    const access_token = config.params.access_token || localStorage.getItem('access_token') || ''
    if (access_token)
      config.headers.set('Authorization', `Bearer ${access_token}`)

    if (config.ibos_sign) {
      const { token, platform, createtime } = generateIbosSignParams()
      config.headers.set('token', token)
      config.headers.set('platform', platform)
      config.headers.set('createtime', createtime)
    }
    if (config.code_sign)
      config.params = generateSignParams(config.params)

    return config
  },
  (error) => {
    return Promise.reject(error.response)
  },
)

service.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    if ([200, 201, 204].includes(response.status))
      return response.data

    throw new Error(response.status.toString())
  },
  (error) => {
    return Promise.reject(error)
  },
)

// 封装通用请求方法
function request<T = any>(config: AxiosRequestConfig): Promise<T> {
  return service(config).then(res => res.data)
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

export const patch = <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
  return request({ ...config, method: 'patch', url, data })
}

export default service
