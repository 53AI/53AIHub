import { message as antdMessage } from 'antd'

import {
  ERROR_MESSAGES,
  RESPONSE_CODE,
  RESPONSE_CODE_MESSAGE_MAP,
  RESPONSE_DATA_MESSAGE_MAP,
  RESPONSE_MESSAGE_MAP,
  RESPONSE_STATUS,
  ResponseMessage,
  type ResponseCode,
  type ResponseStatus,
} from './code'
import { t as i18nT } from '@/locales'

export type TranslateFn = (key: string, params?: Record<string, unknown>) => string

interface ErrorResponse {
  status?: ResponseStatus
  response?: {
    status?: ResponseStatus
    data?: {
      code?: ResponseCode
      message?: string
      data?: any
      [key: string]: unknown
    }
  }
  message?: string
}

export interface HandleErrorOptions {
  ignoreMessage?: boolean
  ignoreStatus?: boolean
  functionName?: string
  featureI18nPrefix?: string
  additionalTokenKeys?: string[]
  t?: TranslateFn
}

const messageCache = new Map<string, number>()
const messageTimers = new Map<string, ReturnType<typeof setTimeout>>()
const CACHE_DURATION = 3000

// 防止 token 过期时多次 reload
let isReloading = false

function showMessage(text: string) {
  const now = Date.now()
  if (messageCache.has(text)) {
    const last = messageCache.get(text)!
    if (now - last < CACHE_DURATION) return
    const existingTimer = messageTimers.get(text)
    if (existingTimer) clearTimeout(existingTimer)
  }

  antdMessage.warning(text)
  messageCache.set(text, now)

  const timer = setTimeout(() => {
    messageCache.delete(text)
    messageTimers.delete(text)
  }, CACHE_DURATION)
  messageTimers.set(text, timer)
}

export function handleError(error: ErrorResponse, options?: HandleErrorOptions): Promise<never> {
  const t = options?.t || i18nT
  const featurePrefix = options?.featureI18nPrefix || 'common'

  const status = error.response?.status || 500

  let resData = error.response?.data
  try {
    if (resData && typeof resData === 'string') resData = JSON.parse(resData)
  } catch {
    resData = {}
  }

  const code = resData?.code
  const data = resData?.data
  let message = resData?.message

  if (error.message === ResponseMessage.Canceled) {
    return Promise.reject(error)
  }

  if (code === RESPONSE_CODE.UNAUTHORIZED_INTERCEPTED) {
    return Promise.reject(error)
  }

  // 特殊错误：功能不可用/超限（保留 key 以便后续接 i18n）
  if (message === 'feature not available: feature over limit') {
    showMessage(t(`${featurePrefix}.feature_over_limit`, { functionName: options?.functionName || '' }))
    return Promise.reject(error)
  }
  if (message === 'feature not available: feature not available') {
    showMessage(t(`${featurePrefix}.feature_not_available`, { functionName: options?.functionName || '' }))
    return Promise.reject(error)
  }

  const messageMatch = RESPONSE_MESSAGE_MAP.get(message || '')
  if (messageMatch) {
    if (messageMatch === 'not_tip') message = ''
    else message = t(messageMatch)
  } else {
    message =
      (data !== undefined && RESPONSE_DATA_MESSAGE_MAP.get(String(data))
        ? t(RESPONSE_DATA_MESSAGE_MAP.get(String(data))!)
        : '') ||
      message ||
      (code !== undefined && RESPONSE_CODE_MESSAGE_MAP.get(Number(code))
        ? t(RESPONSE_CODE_MESSAGE_MAP.get(Number(code))!)
        : '') ||
      (ERROR_MESSAGES.get(status) ? t(ERROR_MESSAGES.get(status)!) : '') ||
      error.message ||
      t('response_message.unknown_error')
  }

  if (message && !options?.ignoreMessage && code !== RESPONSE_CODE.UNAUTHORIZED_ERROR) {
    showMessage(message)
  }

  if (
    code === RESPONSE_CODE.TOKEN_EXPIRED_ERROR ||
    code === RESPONSE_CODE.UNAUTHORIZED_ERROR ||
    (status === RESPONSE_STATUS.UNAUTHORIZED && localStorage.getItem('access_token'))
  ) {
    localStorage.removeItem('access_token')
    localStorage.removeItem('site_token') // 同时清理 site_token
    localStorage.removeItem('user_info') // 清理用户信息缓存
    if (options?.additionalTokenKeys) {
      for (const key of options.additionalTokenKeys) localStorage.removeItem(key)
    }
    // 防止多次 reload
    if (!isReloading) {
      isReloading = true
      window.location.reload()
    }
  }

  return Promise.reject(error)
}

export function clearMessageCache(): void {
  for (const timer of messageTimers.values()) clearTimeout(timer)
  messageCache.clear()
  messageTimers.clear()
}

