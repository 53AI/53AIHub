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

// 复制工具
export { copyToClip, copyImageToClip } from './copy.js'

// URL 工具
export { isUrl, joinUrl, isInternalNetwork } from './url.js'

// 文件工具
export { isOfficeFile, isKKFileViewSupported, getOfficeFileType, downloadFile, downloadImage, downloadSvgAsImage, formatFileSize, formatFileInfo, getFileIconPath, type FormatFileInfoResult } from './file.js'

// 防抖
export { debounce } from './debounce.js'

// MD5
export { md5 } from './md5.js'

// 缓存管理
export { CacheMode, CacheManager, cacheManager } from './cache.js'

// 事件总线
export { eventBus } from './event-bus.js'

// Base64
export {
  base64Encode,
  base64Decode,
  base64URLEncode,
  base64URLDecode,
  base64EncodeBytes,
  base64DecodeBytes,
  blobToBase64,
  base64ToBlob,
  fileToBase64,
  base64ToFile,
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

// 图标转 File
export {
  iconConfig,
  createIconFileFromStatic,
  type IconConfig,
  type CreateIconFileConfig,
} from './img-to-file.js'

// 日期范围
export { getRangeStartEndDates, type DateRangeResult } from './date-range.js'

// 异步工具
export {
  sleep,
  loadScript,
  removeScript,
  runOnIdle,
  type IdleCallbackOptions,
} from './async.js'

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
export { JSONParse, safeParseJson } from './string.js'

// 多语言 CSV 解析（source.csv → vue-i18n messages）
export { parseCSV, csvToMessages } from './csv-to-messages.js'

// ID 工具
export { generateRandomId, generateUUID } from './id.js'

// 问候/时间段（与 moment 互补）
export {
  getGreetingByTime,
} from './time.js'

// 唯一名称生成
export { generateUniqueFolderName, generateUniqueFileName } from './unique-name.js'

// 滚动工具
export {
  findScrollContainer,
  scrollToElement,
  scrollToElementAsync,
} from './scroll.js'

// Chunk 加载错误处理
export {
  isChunkLoadError,
  handleChunkLoadError,
  setupChunkErrorHandler,
} from './chunk-error.js'

// 多账号冲突检测核心
export {
  watchAccountConflict,
  type AccountIdentity,
  type OnAccountConflict,
  type OnTokenRemoved,
} from './multi-account.js'

// 输入工具
export {
  numberInputKeydownHandler,
  restrictToNumberInput,
  removeNumberInputRestrict,
} from './input.js'

// 默认图片处理
export {
  attachDefaultImg,
  detachDefaultImg,
} from './default-img.js'

// 表单验证规则
export {
  textValidator,
  linkValidator,
  accountValidator,
  mobileValidator,
  emailValidator,
  mobileOrEmailValidator,
  passwordValidator,
  urlValidator,
  pathValidator,
  imageValidator,
  variableValidator,
  portValidator,
  numberValidator,
  generateInputRules,
  type RuleItem,
  type ValidatorOpts,
} from './form-rule.js'
