/**
 * Universal entry for environments without DOM (e.g. React Native).
 * Only re-exports modules that do not depend on document/window/navigator.
 * Use this from mobile app: import { ... } from '@km/shared-utils/universal'
 */

// 时间工具
export {
  ONE_SECOND_TIMESTAMP,
  ONE_MINUTE_TIMESTAMP,
  ONE_HOUR_TIMESTAMP,
  ONE_DAY_TIMESTAMP,
  ONE_WEEK_TIMESTAMP,
  getTimeStamp,
  getSimpleDateFormatString,
  getCurrentDate,
  getLastTimeAsDay,
  getLastTimeAsWeek,
  getLastTimeAsMonth,
  getCurrentMonth,
  getCurrentQuarter,
  getCurrentYear,
  getDatesInRange,
  getFormatTimeStamp,
  getDateTimestamp,
  countDown,
} from './moment.js'

// URL 工具（仅纯逻辑，不导出 isInternalNetwork）
export { isUrl, joinUrl } from './url.js'

// 文件工具（仅纯逻辑，不导出 downloadFile 等 DOM 相关）
export { formatFileSize } from './file.js'

// 防抖
export { debounce } from './debounce.js'

// MD5
export { md5 } from './md5.js'

// 事件总线
export { eventBus } from './event-bus.js'

// Base64（仅字符串/字节，不导出 blob/file 相关）
export {
  base64Encode,
  base64Decode,
  base64URLEncode,
  base64URLDecode,
  base64EncodeBytes,
  base64DecodeBytes,
  isValidBase64,
  isValidBase64URL,
} from './base64.js'

// 短ID
export {
  encodeShortId,
  encodeShortIdSync,
  decodeShortId,
  decodeShortIdSync,
  isValidShortId,
  isValidShortIdSync,
  getEncodedLength,
  supportsCompression,
} from './short-id.js'

// 日期范围
export { getRangeStartEndDates, type DateRangeResult } from './date-range.js'

// 异步工具（仅 sleep，不含 loadScript/removeScript/runOnIdle）
export { sleep } from './async.js'

// 类型守卫
export * from './is.js'

// 对象工具
export {
  typeOfData,
  isValidKeyInObject,
  serialize,
  deepCopy,
  assign,
  compare,
  isEmptyObject,
} from './object.js'

// 字符串工具
export { JSONParse } from './string.js'

// 多语言 CSV 解析
export { parseCSV, csvToMessages } from './csv-to-messages.js'

// ID 工具
export { generateRandomId, generateUUID } from './id.js'

// 问候/时间段
export { getGreetingByTime } from './time.js'

// 唯一名称生成
export { generateUniqueFolderName, generateUniqueFileName } from './unique-name.js'
