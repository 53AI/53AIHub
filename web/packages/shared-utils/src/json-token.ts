/**
 * 通用 JSON token 编解码（URL 安全 base64url + JSON.stringify）
 *
 * 把任意 JSON-safe value 编码成一个 URL 里可直接拼接的短串；
 * 解码失败（坏 base64 / 非 JSON / null 输入）一律返回 null，
 * 调用方按需兜底。
 *
 * 用途示例：
 * - 在分享链接里塞一个轻量选择标记（哪些 tab / 哪些字段要展示）
 * - 在路由里透传一个客户端临时参数（不持久化）
 *
 * 不适用于：
 * - 机密数据：base64url 只是编码不是加密，第三方能解开
 * - 大量数据：每次 encode 都全量 JSON 序列化
 */

import { base64URLEncode, base64URLDecode } from './base64.js'

/**
 * 把 JSON-safe value 编码为 URL token。`undefined` / 函数 / Symbol 会被 JSON 忽略，
 * 其它类型遵守 JSON.stringify 规则。
 */
export function encodeJsonToken(value: unknown): string {
  return base64URLEncode(JSON.stringify(value))
}

/**
 * 解码 URL token。失败 / 缺失 / 反序列化抛错 → 返回 null。
 * 用泛型告诉 TS 期望的形状，但运行时不做形状校验 —— 调用方自行 narrow。
 */
export function decodeJsonToken<T = unknown>(token: string | null | undefined): T | null {
  if (!token) return null
  let json: string
  try {
    json = base64URLDecode(token)
  } catch {
    return null
  }
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * 把 token 拼到 URL 后面：保留已有 query / hash 不动，自动选 `?` 或 `&`。
 * 用 URL 解析器处理相对 / 绝对路径；解析失败时退回字符串拼接。
 */
export function appendJsonTokenToUrl(url: string, value: unknown, paramName = 't'): string {
  const token = encodeJsonToken(value)
  try {
    const u = new URL(url)
    u.searchParams.set(paramName, token)
    return u.toString()
  } catch {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}${paramName}=${token}`
  }
}