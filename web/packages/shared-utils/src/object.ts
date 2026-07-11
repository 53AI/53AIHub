/**
 * 对象处理工具函数
 */

/**
 * 获取数据类型 - 精确获取 JavaScript 值的数据类型
 */
export const typeOfData = (source: unknown): string => {
  return Object.prototype.toString.call(source).slice(8, -1)
}

/**
 * 判断在对象数据中是否有效值
 */
export const isValidKeyInObject = (
  key: string | number | symbol,
  source: Record<string | number | symbol, unknown> = {}
): boolean => {
  return !!(
    key &&
    source &&
    Object.keys(source).length &&
    key in source &&
    source[key]
  )
}

/**
 * 序列化对象为 URL 参数字符串
 */
export const serialize = (source: Record<string, unknown>): string => {
  if (!source || typeof source !== 'object') {
    return ''
  }
  return Object.keys(source)
    .filter((key) => isValidKeyInObject(key, source))
    .sort()
    .map((key) => {
      let value = source[key]
      if (typeOfData(value) === 'Object') {
        value = JSON.stringify(value)
      } else if (typeOfData(value) === 'Array') {
        value = (value as unknown[]).join(',')
      }
      return `${key}=${encodeURIComponent(String(value))}`
    })
    .join('&')
}

/**
 * 深拷贝对象 - 支持嵌套对象、数组与 Date
 */
export const deepCopy = <T>(obj: T, ignore: string[] = []): T => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepCopy(item, ignore)) as unknown as T
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T
  }
  const newObj = {} as Record<string, unknown>
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && !ignore.includes(key)) {
      newObj[key] = deepCopy((obj as Record<string, unknown>)[key], ignore)
    }
  }
  return newObj as T
}

/**
 * 对象深度合并
 */
export const assign = <T extends Record<string, unknown>>(
  target: T,
  ...sources: Array<Record<string, unknown>>
): T => {
  const t = target as Record<string, unknown>
  for (const source of sources) {
    if (typeof source === 'object' && source !== null) {
      Object.keys(source).forEach((key) => {
        const value = source[key]
        if (Array.isArray(value)) {
          t[key] = value
        } else if (typeof value === 'object' && value !== null) {
          t[key] = assign(
            (t[key] as Record<string, unknown>) || {},
            value as Record<string, unknown>
          )
        } else {
          t[key] = value
        }
      })
    }
  }
  return target
}

/**
 * 按指定字段比较两个对象是否相等（未指定则比较全文）
 */
export const compare = (
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
  fields: unknown[] = []
): boolean => {
  let object1: Record<string, unknown> = {}
  let object2: Record<string, unknown> = {}
  if (fields && fields.length) {
    ;(fields as string[]).forEach((field) => {
      object1[field] = obj1[field]
      object2[field] = obj2[field]
    })
  } else {
    object1 = obj1
    object2 = obj2
  }
  return JSON.stringify(object1) === JSON.stringify(object2)
}

/**
 * 判断是否为空对象
 */
export const isEmptyObject = (obj: unknown): boolean => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    Object.keys(obj as object).length === 0 &&
    (obj as object).constructor === Object
  )
}
