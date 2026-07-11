/**
 * 工具函数统一导出（来自 @km/shared-utils + 本地 config/filter 等）
 */
export {
  getTimeStamp,
  sleep,
  loadScript,
  removeScript,
  runOnIdle,
  type IdleCallbackOptions,
} from '@km/shared-utils'

export {
  isValidKeyInObject,
  typeOfData,
  serialize,
  deepCopy,
  assign,
  compare,
  isEmptyObject,
} from '@km/shared-utils'

export { joinUrl, JSONParse } from '@km/shared-utils'

export { generateRandomId, generateUUID } from '@km/shared-utils'

export { isFunction, isObject } from '@km/shared-utils'

export * from './filter'
export { default as loadLib, LIB_NAME } from './loadLib'
export { TimerManager, globalTimerManager, useTimerManager } from './timer-manager'
export type { TimerType, TimerInfo } from './timer-manager'
export { checkKMPermission, checkHasKMPermission } from './km-permission'
export type { PermissionCheckResult } from './km-permission'
export * from './form-rule'
export { generateFormRules, type ValidatorType } from './form-rule.v2'
export { validateFormField } from './form-validator'
export * from './is'
export { default as getWecomInstance } from './wecom'
