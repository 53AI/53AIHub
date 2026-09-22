/**
 * 密码强度策略的回归测试（门槛表 + 结构化校验结果）
 *
 * 场景：weak(8-20 不限类型) / medium(8-20 任 3 类) / strong(10-20 四类全含)，
 * 且空值必须放过（空值由表单 required 规则负责，避免同一字段出现两条提示）。
 */
import { describe, expect, it } from 'vitest'

import {
  PASSWORD_STRENGTH_RULES,
  countPasswordClasses,
  validatePasswordByStrength,
} from '@km/shared-utils'

describe('PASSWORD_STRENGTH_RULES', () => {
  it('三档门槛与业务口径一致', () => {
    expect(PASSWORD_STRENGTH_RULES.weak).toEqual({ min: 8, max: 20, minClasses: 0 })
    expect(PASSWORD_STRENGTH_RULES.medium).toEqual({ min: 8, max: 20, minClasses: 3 })
    expect(PASSWORD_STRENGTH_RULES.strong).toEqual({ min: 10, max: 20, minClasses: 4 })
  })
})

describe('countPasswordClasses', () => {
  it('按大写 / 小写 / 数字 / 符号统计类数', () => {
    expect(countPasswordClasses('abcdefgh')).toBe(1)
    expect(countPasswordClasses('abcdef12')).toBe(2)
    expect(countPasswordClasses('abcABC12')).toBe(3)
    expect(countPasswordClasses('abcABC1!')).toBe(4)
  })
})

describe('validatePasswordByStrength', () => {
  it('空值放过（交由 required 规则处理）', () => {
    expect(validatePasswordByStrength('', 'weak')).toBeNull()
    expect(validatePasswordByStrength('', 'medium')).toBeNull()
    expect(validatePasswordByStrength('', 'strong')).toBeNull()
  })

  it('weak：8-20 位不限字符类型', () => {
    expect(validatePasswordByStrength('1234567', 'weak')).toEqual({
      type: 'length',
      min: 8,
      max: 20,
    })
    expect(validatePasswordByStrength('12345678', 'weak')).toBeNull()
    expect(validatePasswordByStrength('a'.repeat(21), 'weak')).toEqual({
      type: 'length',
      min: 8,
      max: 20,
    })
  })

  it('medium：8-20 位且至少 3 类字符', () => {
    expect(validatePasswordByStrength('abcdef12', 'medium')).toEqual({
      type: 'classes',
      required: 3,
      actual: 2,
    })
    expect(validatePasswordByStrength('abcABC12', 'medium')).toBeNull()
  })

  it('strong：10-20 位且四类字符全含', () => {
    expect(validatePasswordByStrength('abcABC1!', 'strong')).toEqual({
      type: 'length',
      min: 10,
      max: 20,
    })
    expect(validatePasswordByStrength('abcABC123!', 'strong')).toBeNull()
    expect(validatePasswordByStrength('abcABC1234', 'strong')).toEqual({
      type: 'classes',
      required: 4,
      actual: 3,
    })
  })

  it('中文与空格对所有档位都拒绝', () => {
    expect(validatePasswordByStrength('Abcd1234中', 'weak')).toEqual({ type: 'chinese' })
    expect(validatePasswordByStrength('Abcd 1234', 'weak')).toEqual({ type: 'space' })
    expect(validatePasswordByStrength('abcABC12 中', 'strong')).toEqual({ type: 'space' })
  })

  it('全角空格与 Tab 同样判定为空格', () => {
    expect(validatePasswordByStrength('Abcd　1234', 'weak')).toEqual({ type: 'space' })
    expect(validatePasswordByStrength('Abcd\t1234', 'weak')).toEqual({ type: 'space' })
  })

  it('校验顺序固定：长度 → 空格 → 中文 → 类数', () => {
    // 既短又含空格时先报长度
    expect(validatePasswordByStrength('a b', 'medium')).toEqual({
      type: 'length',
      min: 8,
      max: 20,
    })
    // 长度合法但既含空格又含中文时先报空格
    expect(validatePasswordByStrength('abcd 123中文', 'medium')).toEqual({ type: 'space' })
  })
})
