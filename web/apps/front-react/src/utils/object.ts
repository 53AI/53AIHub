/**
 * 对象处理工具函数
 */

/**
 * 深拷贝对象
 * @param obj 要拷贝的对象
 */
export const deepCopy = <T>(obj: T): T => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepCopy(item)) as unknown as T
  }

  const copy = {} as T
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      copy[key] = deepCopy(obj[key]) as T[Extract<keyof T, string>]
    }
  }

  return copy
}

/**
 * 对象属性合并
 * @param target 目标对象
 * @param source 源对象
 */
export const assign = <T extends object, S extends object>(target: T, source: S): T & S => {
  return Object.assign({}, target, source)
}

/**
 * 判断是否为空对象
 * @param obj 要检查的对象
 */
export const isEmpty = (obj: object): boolean => {
  return Object.keys(obj).length === 0
}

/**
 * 获取对象的嵌套属性值
 * @param obj 对象
 * @param path 属性路径（如 'a.b.c'）
 * @param defaultValue 默认值
 */
export const get = <T = any>(obj: any, path: string, defaultValue?: T): T | undefined => {
  const keys = path.split('.')
  let result = obj

  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue
    }
    result = result[key]
  }

  return result !== undefined ? result : defaultValue
}

/**
 * 设置对象的嵌套属性值
 * @param obj 对象
 * @param path 属性路径
 * @param value 要设置的值
 */
export const set = (obj: any, path: string, value: any): void => {
  const keys = path.split('.')
  let current = obj

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key]
  }

  current[keys[keys.length - 1]] = value
}
