import { message } from 'antd'

import {
  RESPONSE_CODE,
  RESPONSE_STATUS,
  ERROR_MESSAGES,
  RESPONSE_CODE_MESSAGE_MAP,
  RESPONSE_DATA_MESSAGE_MAP,
  RESPONSE_MESSAGE_MAP,
  ResponseMessage
} from './code'
import type { ResponseCode, ResponseStatus } from './code'


// 定义错误响应接口
interface ErrorResponse {
  status?: ResponseStatus
  response?: {
    status?: ResponseStatus
    data?: {
      code?: ResponseCode
      message?: string
    }
  }
  message?: string
}

interface HandleErrorOptions {
  // 是否忽略消息显示
  ignoreMessage?: boolean
  // 是否忽略状态码
  ignoreStatus?: boolean
  // 是否忽略认证错误（如401），不进行自动登出处理
  ignoreAuth?: boolean
  // 功能名称，在错误消息中显示
  functionName?: string
}

// 消息缓存，用于防止重复显示
const messageCache = new Map<string, number>()
const messageTimers = new Map<string, ReturnType<typeof setTimeout>>() // 存储定时器ID
const CACHE_DURATION = 3000 // 3秒内相同消息不重复显示

// 显示消息（带去重功能）
function showMessage(msg: string) {
  const now = Date.now()

  // 检查是否在缓存期内
  if (messageCache.has(msg)) {
    const lastShowTime = messageCache.get(msg)!
    if (now - lastShowTime < CACHE_DURATION) {
      return // 跳过显示
    }

    // 清除之前的定时器
    const existingTimer = messageTimers.get(msg)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }
  }

  // 显示消息并更新缓存
  message.warning(msg)
  messageCache.set(msg, now)

  // 设置新的定时器并存储ID
  const timer = setTimeout(() => {
    messageCache.delete(msg)
    messageTimers.delete(msg)
  }, CACHE_DURATION)

  messageTimers.set(msg, timer)
}

// 统一错误处理
export function handleError(error: ErrorResponse, options?: HandleErrorOptions): Promise<never> {
  const status = error.response?.status || 500
  const code = error.response?.data?.code
  const data = error.response?.data?.data as string | undefined
  let msg = error.response?.data?.message

  if (error.message === ResponseMessage.Canceled) {
    return Promise.reject(error)
  }
  if (code === RESPONSE_CODE.UNAUTHORIZED_INTERCEPTED) {
    return Promise.reject(error)
  }

  // 处理特殊错误
  if (msg === 'feature not available: feature over limit') {
    return Promise.reject(message.warning(window.$t('common.feature_over_limit', { functionName: options?.functionName })))
  }
  if (msg === 'feature not available: feature not available') {
    return Promise.reject(message.warning(window.$t('common.feature_not_available', { functionName: options?.functionName })))
  }

  const messageMatch = RESPONSE_MESSAGE_MAP.get(msg || '')
  if (messageMatch) {
    if (messageMatch === 'not_tip') msg = ''
    else msg = window.$t(messageMatch)
  } else {
    // 优化消息获取逻辑
    // 先看错误集里有没有转换的信息提示，
    // 然后是错误信息显示，
    // 如果没有则Code相关的错误提示，最后是错误信
    msg =
      (data !== undefined && RESPONSE_DATA_MESSAGE_MAP.get(data)
        ? window.$t(RESPONSE_DATA_MESSAGE_MAP.get(data)!)
        : '') ||
      msg ||
      (code !== undefined && RESPONSE_CODE_MESSAGE_MAP.get(code)
        ? window.$t(RESPONSE_CODE_MESSAGE_MAP.get(code)!)
        : '') ||
      (ERROR_MESSAGES.get(status as any) ? window.$t(ERROR_MESSAGES.get(status as any)!) : '') ||
      error.message ||
      window.$t('response_message.unknown_error')
  }

  // 处理后端参数验证错误消息（Go gin 框架格式）
  if (msg?.startsWith('param error:'))  {
    msg = (window.$t('response_code.param_error') || '参数错误，请检查输入') + '：' + msg.replace('param error:', '').trim()
  }

  // 使用带去重功能的消息显示
  if (msg && !options?.ignoreMessage && msg !== '账户已被禁用') {
    showMessage(msg)
  }

  if (!options?.ignoreAuth &&
    (code === RESPONSE_CODE.TOKEN_EXPIRED_ERROR ||
    (status === RESPONSE_STATUS.UNAUTHORIZED && localStorage.getItem('access_token')))
  ) {
    localStorage.removeItem('access_token')
    window.location.reload(true)
  }
  return Promise.reject(error)
}

// 清理所有消息缓存和定时器（可选，用于应用退出时清理）
export function clearMessageCache(): void {
  // 清理所有定时器
  for (const timer of messageTimers.values()) {
    clearTimeout(timer)
  }

  // 清空缓存
  messageCache.clear()
  messageTimers.clear()
}
