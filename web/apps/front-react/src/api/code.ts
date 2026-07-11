// 使用枚举替代常量
export const RESPONSE_CODE = {
  SUCCESS: 0,
  PARAM_ERROR: 1,
  DATABASE_ERROR: 2,
  NETWORK_ERROR: 3,
  SYSTEM_ERROR: 4,
  AUTH_ERROR: 5,
  NOT_FOUND_ERROR: 6,
  UNAUTHORIZED_ERROR: 7,
  FILE_ERROR: 8,
  FORBIDDEN_ERROR: 9,
  AGENT_ERROR: 10,
  TOKEN_EXPIRED_ERROR: 11,

  VERIFICATION_CODE_ERROR: -14,

  // 未认证被拦截
  UNAUTHORIZED_INTERCEPTED: 1000,
} as const

export type ResponseCode = typeof RESPONSE_CODE[keyof typeof RESPONSE_CODE]

export const RESPONSE_STATUS = {
  SUCCESS: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

export type ResponseStatus = typeof RESPONSE_STATUS[keyof typeof RESPONSE_STATUS]

export const ResponseMessage = {
  Canceled: 'canceled',
} as const

export const RESPONSE_CODE_MESSAGE_MAP = new Map([
  [RESPONSE_CODE.SUCCESS, 'response_code.success'],
  [RESPONSE_CODE.PARAM_ERROR, 'response_code.param_error'],
  [RESPONSE_CODE.DATABASE_ERROR, 'response_code.database_error'],
  [RESPONSE_CODE.NETWORK_ERROR, 'response_code.network_error'],
  [RESPONSE_CODE.SYSTEM_ERROR, 'response_code.system_error'],
  [RESPONSE_CODE.AUTH_ERROR, 'response_code.auth_error'],
  [RESPONSE_CODE.NOT_FOUND_ERROR, 'response_code.not_found_error'],
  [RESPONSE_CODE.UNAUTHORIZED_ERROR, 'response_code.unauthorized_error'],
  [RESPONSE_CODE.FILE_ERROR, 'response_code.file_error'],
  [RESPONSE_CODE.FORBIDDEN_ERROR, 'response_code.forbidden_error'],
  [RESPONSE_CODE.AGENT_ERROR, 'response_code.agent_error'],
  [RESPONSE_CODE.TOKEN_EXPIRED_ERROR, 'response_code.token_expired_error'],
  [RESPONSE_CODE.VERIFICATION_CODE_ERROR, 'response_code.verification_code_error'],
])

// 错误码映射
export const ERROR_MESSAGES = new Map([
  [RESPONSE_STATUS.BAD_REQUEST, 'response_status.400'],
  [RESPONSE_STATUS.UNAUTHORIZED, 'response_status.401'],
  [RESPONSE_STATUS.FORBIDDEN, 'response_status.403'],
  [RESPONSE_STATUS.NOT_FOUND, 'response_status.404'],
  [RESPONSE_STATUS.SERVICE_UNAVAILABLE, 'response_status.500'],
  [RESPONSE_STATUS.BAD_GATEWAY, 'response_status.502'],
  [RESPONSE_STATUS.INTERNAL_SERVER_ERROR, 'response_status.503'],
  [RESPONSE_STATUS.GATEWAY_TIMEOUT, 'response_status.504'],
])

export const RESPONSE_MESSAGE_MAP = new Map([
  // ['unauthorized: user not found', 'response_message.user_not_found'],
  ['unauthorized: user not found', 'not_tip'],
  ['unauthorized: record not found', 'not_tip'],
  ['not found: User not found', 'response_message.wechat_user_not_found'],
  ['param error: username already exists', 'response_message.username_already_exists'],
  ['invalid or expired verification code', 'response_message.code_expired_or_invalid'],
  ['invalid or expired verification code: invalid or expired verification code', 'response_message.code_expired_or_invalid'],
  ['unauthorized: invalid or expired verification code', 'response_message.code_expired_or_invalid'],
  ['auth failed: verification code expired or invalid', 'response_message.code_expired_or_invalid'],
  ['auth failed: invalid or expired verification code', 'response_message.code_expired_or_invalid'],
  ['unauthorized: username or password is incorrect', 'response_message.username_or_password_is_incorrect'],
  ['auth failed: This email has been bound by another user', 'response_message.email_already_bind'],
  ['auth failed: This mobile has been bound by another user', 'response_message.mobile_already_bind'],
  ['param error: This WeChat account is already bound to another user', 'response_message.wechat_already_bind'],
  ['operate too fast', 'response_message.operate_too_fast'],
  ['auth failed', 'response_message.auth_failed'],
  ['file error: library name already exists in this space', 'response_message.name_already_exists'],

])

export const RESPONSE_DATA_MESSAGE_MAP = new Map([
  ['该域名已被绑定', 'response_data.domain_already_bound'],
  ['您已有一个正在审核中的申请', 'response_data.apply_already_submitted'],
])
