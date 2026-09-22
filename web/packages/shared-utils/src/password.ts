/**
 * 密码强度策略
 *
 * weak / medium / strong 三档门槛的唯一权威定义，前后台共用。
 * 只返回结构化校验结果，**不包含任何提示文案** —— 文案由各 app 的 i18n 负责，
 * 便于同一份门槛渲染成前台的 `form.*` 与后台的 `login.*`。
 */

export type PasswordStrength = 'weak' | 'medium' | 'strong'

export interface PasswordStrengthRule {
  min: number
  max: number
  /** 需包含的字符类数：0 = 不限；3 = 四类中任意 3 类；4 = 四类全含 */
  minClasses: number
}

/**
 * 门槛表（业务口径，与后台「密码强度」页文案一致）
 *
 * - weak：8-20 位，不限字符类型（兼容历史系统 / 测试环境，仅限可信内网）
 * - medium：8-20 位，大写 / 小写 / 数字 / 符号 任意 3 类
 * - strong：10-20 位，四类全含（弱口令与历史密码重复校验需后端承担）
 *
 * 下限 8 与后端 `validate:"min=8,max=20"` 对齐：前端放过 6 位只会让用户白填一次再吃 400。
 */
export const PASSWORD_STRENGTH_RULES: Record<PasswordStrength, PasswordStrengthRule> = {
  weak: { min: 8, max: 20, minClasses: 0 },
  medium: { min: 8, max: 20, minClasses: 3 },
  strong: { min: 10, max: 20, minClasses: 4 },
}

export const PASSWORD_STRENGTHS = ['weak', 'medium', 'strong'] as const

/** 校验接口下发的 strength 是否合法（用于解析设置接口返回值） */
export function isPasswordStrength(value: unknown): value is PasswordStrength {
  return typeof value === 'string' && (PASSWORD_STRENGTHS as readonly string[]).includes(value)
}

const CHINESE_RE = /[\u4e00-\u9fa5]/
const SPACE_RE = /\s/

/** 是否包含中文（密码通用约束，与强度档位无关） */
export function passwordHasChinese(value: string): boolean {
  return CHINESE_RE.test(value)
}

/** 是否包含空白字符（含全角空格、Tab，密码通用约束，与强度档位无关） */
export function passwordHasSpace(value: string): boolean {
  return SPACE_RE.test(value)
}

/** 命中的字符类数量（大写 / 小写 / 数字 / 符号） */
export function countPasswordClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length
}

export type PasswordFailure =
  | { type: 'length'; min: number; max: number }
  | { type: 'classes'; required: number; actual: number }
  | { type: 'chinese' }
  | { type: 'space' }

/**
 * 按强度档位校验密码
 *
 * 校验顺序固定：长度 → 空格 → 中文 → 字符类型，保证提示稳定可预期。
 * 空值返回 `null`（放行）—— 空值由表单的 required 规则负责，避免同一字段出现两条提示。
 */
export function validatePasswordByStrength(
  value: string,
  strength: PasswordStrength,
): PasswordFailure | null {
  if (!value) return null

  const { min, max, minClasses } = PASSWORD_STRENGTH_RULES[strength]
  if (value.length < min || value.length > max) return { type: 'length', min, max }
  if (passwordHasSpace(value)) return { type: 'space' }
  if (passwordHasChinese(value)) return { type: 'chinese' }

  if (minClasses > 0) {
    const actual = countPasswordClasses(value)
    if (actual < minClasses) return { type: 'classes', required: minClasses, actual }
  }

  return null
}
