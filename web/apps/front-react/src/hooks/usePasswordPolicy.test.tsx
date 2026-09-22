/**
 * 密码强度策略 hook 回归测试
 *
 * 覆盖：三档生效、未配置 / 非法 JSON / 请求失败统一兜底 weak（与后台配置页「未配置」定义一致）、
 * 并发与缓存只请求一次，以及规则放过空值（空值只由 required 负责）。
 */
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@/locales'

const get = vi.fn()

vi.mock('@/api/modules/setting', () => ({
  settingApi: { get: (...args: unknown[]) => get(...args) },
  default: { get: (...args: unknown[]) => get(...args) },
}))

import {
  buildPasswordRule,
  fetchPasswordStrength,
  resetPasswordPolicyCache,
  usePasswordPolicy,
} from './usePasswordPolicy'

const respondWith = (strength?: string) =>
  get.mockResolvedValue({ value: strength ? JSON.stringify({ strength }) : '' })

const validate = (strength: 'weak' | 'medium' | 'strong', value: string) =>
  buildPasswordRule(strength).validator({}, value) as Promise<void>

beforeEach(() => {
  get.mockReset()
  resetPasswordPolicyCache()
})

describe('fetchPasswordStrength', () => {
  it('读取企业配置的强度', async () => {
    respondWith('strong')
    await expect(fetchPasswordStrength()).resolves.toBe('strong')
    expect(get).toHaveBeenCalledWith('password_security_policy')
  })

  it('未配置时兜底 weak', async () => {
    respondWith()
    await expect(fetchPasswordStrength()).resolves.toBe('weak')
  })

  it('strength 非法时兜底 weak', async () => {
    respondWith('super-strong')
    await expect(fetchPasswordStrength()).resolves.toBe('weak')
  })

  it('value 不是合法 JSON 时兜底 weak', async () => {
    get.mockResolvedValue({ value: 'not-json' })
    await expect(fetchPasswordStrength()).resolves.toBe('weak')
  })

  it('请求失败时兜底 weak', async () => {
    get.mockRejectedValue(new Error('network down'))
    await expect(fetchPasswordStrength()).resolves.toBe('weak')
  })

  it('并发调用只请求一次', async () => {
    respondWith('strong')
    await expect(
      Promise.all([fetchPasswordStrength(), fetchPasswordStrength(), fetchPasswordStrength()])
    ).resolves.toEqual(['strong', 'strong', 'strong'])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('缓存命中后不再请求', async () => {
    respondWith('weak')
    await fetchPasswordStrength()
    await fetchPasswordStrength()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('清缓存后重新请求', async () => {
    respondWith('weak')
    await fetchPasswordStrength()
    resetPasswordPolicyCache()
    respondWith('strong')
    await expect(fetchPasswordStrength()).resolves.toBe('strong')
    expect(get).toHaveBeenCalledTimes(2)
  })
})

describe('usePasswordPolicy', () => {
  it('取到策略后返回对应强度', async () => {
    respondWith('strong')
    const { result } = renderHook(() => usePasswordPolicy())
    await waitFor(() => expect(result.current.strength).toBe('strong'))
  })

  it('请求失败时保持兜底强度', async () => {
    get.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => usePasswordPolicy())
    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(result.current.strength).toBe('weak')
  })
})

describe('buildPasswordRule', () => {
  it('放过空值（交给 required 规则）', async () => {
    await expect(validate('strong', '')).resolves.toBeUndefined()
  })

  it('weak 下 8 位纯数字通过', async () => {
    await expect(validate('weak', '12345678')).resolves.toBeUndefined()
  })

  it('medium 下 8 位仅两类字符被拒', async () => {
    await expect(validate('medium', 'abcdef12')).rejects.toThrow(
      t('form.password_mix_classes', { count: 3 })
    )
  })

  it('strong 下 9 位被拒（长度下限 10）', async () => {
    await expect(validate('strong', 'abcABC1!')).rejects.toThrow(
      t('form.password_length_range', { min: 10, max: 20 })
    )
  })

  it('strong 下 10 位四类全含通过', async () => {
    await expect(validate('strong', 'abcABC123!')).resolves.toBeUndefined()
  })

  it('含空格 / 中文按固定顺序提示', async () => {
    await expect(validate('medium', 'abcd 1234')).rejects.toThrow(t('form.password_no_space'))
    await expect(validate('medium', 'abcd1234中')).rejects.toThrow(
      t('form.password_no_chinese')
    )
  })
})
