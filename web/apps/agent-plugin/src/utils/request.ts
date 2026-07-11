import axios from 'axios'
import { api_host } from '../config/api'
import { getCurrentAccessToken } from '../stores/user'

const service = axios.create({
  baseURL: api_host
})

service.interceptors.request.use(
  (config) => {
    const access_token = getCurrentAccessToken()
    if (access_token) {
      config.headers.set('Authorization', `Bearer ${access_token}`)
    }
    return config
  },
  (error) => Promise.reject(error)
)

service.interceptors.response.use(
  (response) => {
    if ([200, 201, 204].includes(response.status)) {
      return response.data
    }
    throw new Error(response.status.toString())
  },
  (error) => Promise.reject(error)
)

export default service