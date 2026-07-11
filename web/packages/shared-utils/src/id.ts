/**
 * ID 生成工具
 */

/**
 * 生成指定长度的随机字符串，可选首字符为非数字、可选格式化为 UUID 形式
 */
export const generateRandomId = (
  length: number,
  isvar = false,
  isUuid = false
): string => {
  const numberChars = '0123456789'
  const nonNumericChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const characters = nonNumericChars + numberChars
  let result = ''
  if (isvar) {
    result += nonNumericChars[Math.floor(Math.random() * nonNumericChars.length)]
  } else {
    result += characters[Math.floor(Math.random() * characters.length)]
  }
  for (let i = 1; i < length; i++) {
    result += characters[Math.floor(Math.random() * characters.length)]
  }
  if (isUuid) {
    result = result.toLowerCase()
    return result.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
  }
  return result
}

/**
 * 生成 UUID（优先使用 crypto.randomUUID）
 */
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const tempUrl = URL.createObjectURL(new Blob())
  const uuid = tempUrl.toString()
  URL.revokeObjectURL(tempUrl)
  return uuid.slice(uuid.lastIndexOf('/') + 1)
}
