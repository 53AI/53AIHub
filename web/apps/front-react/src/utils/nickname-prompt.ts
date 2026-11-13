/**
 * 昵称异常（企业微信未返回真实昵称）判定与提示节流。
 *
 * 背景：企业微信登录时后端拿不到用户昵称，会退回用 openid 当 nickname，
 * 表现为一长串「字母 + 数字」的 ID（如 `oGZUI0egBJY1zhBYw2KhdUfwVJJE`）。
 * 这种昵称展示给用户不友好，登录后需要引导用户自行修改。
 */

/** 已提示过的时间戳，用于 7 天只弹一次 */
export const NICKNAME_PROMPT_STORAGE_KEY = 'nickname_prompt_shown_at'

/** 提示间隔：7 天 */
export const NICKNAME_PROMPT_INTERVAL = 7 * 24 * 60 * 60 * 1000

/**
 * 判定昵称是否像 openid：一长串字母数字。
 *
 * 规则（全部满足才算）：
 * 1. 长度 >= 16（openid 通常 28 位，正常昵称极少超过 16 个字符）
 * 2. 只含 ASCII 字母与数字（含下划线、连字符，openid 常见分隔符）
 * 3. 必须同时包含字母和数字（排除「aaaaaaaaaaaaaaaa」这种纯重复字母）
 * 4. 不含中文、空格、常见符号等人类昵称特征
 */
export function isOpenidLikeNickname(nickname?: string | null): boolean {
  const value = (nickname ?? '').trim()
  if (value.length < 16) return false
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
  const hasLetter = /[A-Za-z]/.test(value)
  const hasDigit = /[0-9]/.test(value)
  return hasLetter && hasDigit
}

/**
 * 是否需要弹出「修改昵称」提示。
 * 同一 openid 昵称在 7 天内只提示一次；昵称变化后会重新计时。
 */
export function shouldPromptNicknameFix(nickname?: string | null): boolean {
  if (!isOpenidLikeNickname(nickname)) return false
  try {
    const raw = localStorage.getItem(NICKNAME_PROMPT_STORAGE_KEY)
    if (!raw) return true
    const record = JSON.parse(raw) as { value?: string; time?: number }
    // 昵称已变更（说明用户改过了或换了账号），允许重新提示
    if (record.value !== nickname) return true
    const elapsed = Date.now() - (record.time ?? 0)
    return elapsed >= NICKNAME_PROMPT_INTERVAL
  } catch {
    // localStorage 不可用或数据损坏时按「需要提示」处理
    return true
  }
}

/** 记录本次已提示，7 天内不再弹 */
export function markNicknamePrompted(nickname: string): void {
  try {
    localStorage.setItem(
      NICKNAME_PROMPT_STORAGE_KEY,
      JSON.stringify({ value: nickname, time: Date.now() }),
    )
  } catch {
    // localStorage 不可用时忽略，不影响主流程
  }
}
