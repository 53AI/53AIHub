/**
 * 字符串处理工具
 */

/**
 * 安全解析 JSON，解析失败时返回默认值
 */
export const JSONParse = <T = unknown>(value: string, defaultValue: T): T => {
  try {
    return JSON.parse(value) as T
  } catch {
    return defaultValue
  }
}

/**
 * 安全解析 JSON
 * - 输入为空时返回 null
 * - 输入为 object 时直接返回
 * - 解析失败时返回 null
 */
export const safeParseJson = <T = unknown>(data: string | object | undefined): T | null => {
  if (!data) return null
  if (typeof data === 'object') return data as T
  try {
    return JSON.parse(data as string) as T
  } catch {
    return null
  }
}
