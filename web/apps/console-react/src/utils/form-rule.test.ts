/**
 * passwordNoSpaceRule 的回归测试
 *
 * 场景：设置新密码时不允许包含空格（键入由 noSpaceKeydownHandler 拦截，
 * 粘贴 / 自动填充等路径由本规则兜底）。
 */
import { describe, expect, it, vi } from 'vitest'

import { passwordNoSpaceRule, passwordStrengthRule } from './form-rule'

const validate = (value: unknown) =>
  passwordNoSpaceRule().validator(null, value) as Promise<void>

const validateStrength = (value: unknown, strength: 'weak' | 'medium' | 'strong') =>
  passwordStrengthRule(strength).validator(null, value) as Promise<void>

describe('passwordNoSpaceRule', () => {
  it('无空格时通过', async () => {
    await expect(validate('Abcd1234')).resolves.toBeUndefined()
  })

  it('含空格 / 全角空格 / Tab 时拒绝', async () => {
    await expect(validate('Abcd 1234')).rejects.toThrow()
    await expect(validate(' Abcd1234')).rejects.toThrow()
    await expect(validate('Abcd　1234')).rejects.toThrow()
    await expect(validate('Abcd\t1234')).rejects.toThrow()
  })

  it('空值放行，交给 required / 长度规则提示', async () => {
    await expect(validate('')).resolves.toBeUndefined()
    await expect(validate(undefined)).resolves.toBeUndefined()
  })

  it('错误文案走 i18n key', async () => {
    ;(window as any).$t = vi.fn((key: string) => `t:${key}`)
    await expect(validate('Abcd 1234')).rejects.toThrow('t:login.password_no_space')
  })
})

describe('passwordStrengthRule', () => {
  it('默认档位为 weak（未配置）', async () => {
    await expect(
      (passwordStrengthRule().validator as any)(null, '12345678'),
    ).resolves.toBeUndefined()
    await expect(
      (passwordStrengthRule().validator as any)(null, '1234567'),
    ).rejects.toThrow()
  })

  it('空值放行，交给 required 提示', async () => {
    for (const s of ['weak', 'medium', 'strong'] as const) {
      await expect(validateStrength('', s)).resolves.toBeUndefined()
      await expect(validateStrength(undefined, s)).resolves.toBeUndefined()
    }
  })

  it('weak：8-20 位不限字符类型', async () => {
    await expect(validateStrength('12345678', 'weak')).resolves.toBeUndefined()
    await expect(validateStrength('1234567', 'weak')).rejects.toThrow()
    await expect(validateStrength('a'.repeat(21), 'weak')).rejects.toThrow()
  })

  it('medium：8-20 位且至少 3 类字符', async () => {
    await expect(validateStrength('abcd1234!', 'medium')).resolves.toBeUndefined()
    await expect(validateStrength('abcdefgh', 'medium')).rejects.toThrow()
  })

  it('strong：10-20 位且四类字符全含', async () => {
    await expect(validateStrength('Abcd1234!@', 'strong')).resolves.toBeUndefined()
    await expect(validateStrength('Abcd1234!', 'strong')).rejects.toThrow()
  })

  it('中文 / 空格同样拒绝', async () => {
    await expect(validateStrength('abcd1234 中文', 'weak')).rejects.toThrow()
  })

  it('长度 / 类数文案带占位符参数', async () => {
    ;(window as any).$t = vi.fn(
      (key: string, params?: Record<string, unknown>) =>
        `${key}:${JSON.stringify(params ?? {})}`,
    )
    await expect(validateStrength('abc', 'medium')).rejects.toThrow(
      'login.password_length_range:{"min":8,"max":20}',
    )
    await expect(validateStrength('abcdefgh', 'medium')).rejects.toThrow(
      'login.password_mix_classes:{"count":3}',
    )
  })
})
