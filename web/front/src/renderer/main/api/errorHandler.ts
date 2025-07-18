import { ElMessage } from 'element-plus'

import type { ResponseCode, ResponseStatus } from './code'
import {
  RESPONSE_CODE,
  RESPONSE_STATUS,
  ResponseMessage,
  RESPONSE_MESSAGE_MAP,
  RESPONSE_CODE_MESSAGE_MAP,
  ERROR_MESSAGES
} from './code'

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

// 统一错误处理
export function handleError(error: ErrorResponse): Promise<never> {
  const response = error.response || {}
  const data = response.data || error || {}
  const status = response.status || 500
  const { code } = data
  let { message } = data
  if (error.message === ResponseMessage.Canceled) {
    return Promise.reject(error)
  }
  if (code === RESPONSE_CODE.UNAUTHORIZED_INTERCEPTED) {
    return Promise.reject(error)
  }

  if (message === 'feature not available: feature over limit') {
    return ElMessageBox.confirm(
      window.$t('upgrade_dialog.title'),
      window.$t('upgrade_dialog.cancel'),
      {
        customClass: 'version-upgrade-dialog',
        showCancelButton: false
      }
    )
  }

  const messageMatch = RESPONSE_MESSAGE_MAP.get(message || '')
  if (messageMatch) {
    if (messageMatch === 'not_tip') {
      message = ''
    } else {
      message = window.$t(messageMatch)
    }
  } else {
    // 优化消息获取逻辑
    message =
      (code !== undefined && RESPONSE_CODE_MESSAGE_MAP.get(code)
        ? window.$t(RESPONSE_CODE_MESSAGE_MAP.get(code)!)
        : '') ||
      ERROR_MESSAGES.get(status) ||
      error.message ||
      window.$t('response_message.unknown_error')
  }
  if (message) {
    ElMessage.error(message)
  }
  if (
    code === RESPONSE_CODE.TOKEN_EXPIRED_ERROR ||
    (status === RESPONSE_STATUS.UNAUTHORIZED && localStorage.getItem('access_token'))
  ) {
    localStorage.removeItem('access_token')
    window.location.reload(true)
  }
  return Promise.reject(error)
}
