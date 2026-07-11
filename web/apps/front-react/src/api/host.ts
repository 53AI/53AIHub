import { api_host, admin_url } from '@/utils/config'


// 导出配置常量
export const API_HOST = api_host
export const ADMIN_URL = admin_url

// 基于API_HOST的派生配置
export const IMG_HOST = `${API_HOST}/api/images`
export const LIB_HOST = `${API_HOST}/api/libs`
