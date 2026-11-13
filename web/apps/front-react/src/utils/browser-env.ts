/**
 * 浏览器环境判定（仅依赖 UA 字符串，不引入任何业务模块）。
 *
 * 说明：`utils/wecom.ts` 里也有一个 `isInQw`，但它是
 * `/wxwork|micromessenger/` —— 普通微信（UA 只有 MicroMessenger）也会命中，
 * 且该文件依赖已不存在的 `@/api/modules/wecom`，无法被安全引用。
 * 需要「是否在企业微信内置浏览器」时统一用这里的实现。
 */

/**
 * 判断 UA 是否为企业微信内置浏览器。
 *
 * 企微 UA 形如 `... wxwork/4.1.10 MicroMessenger/7.0.1 ...`，
 * 因此必须用 `wxwork` 判定，不能只用 `MicroMessenger`（否则普通微信也命中）。
 */
export function isWecomUserAgent(ua: string): boolean {
  return /wxwork/i.test(ua || '')
}

/** 当前是否运行在企业微信内置浏览器中 */
export function isWecomBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return isWecomUserAgent(navigator.userAgent)
}
