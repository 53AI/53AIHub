import { describe, expect, it } from 'vitest'
import { hasMatcherValue } from './matcher'

describe('hasMatcherValue', () => {
  it('字符串值：非空为 true，空串/纯空白为 false', () => {
    expect(hasMatcherValue({ value: 'pdf' })).toBe(true)
    expect(hasMatcherValue({ value: '' })).toBe(false)
    expect(hasMatcherValue({ value: '   ' })).toBe(false)
  })

  it('数组值：任一项非空即为 true', () => {
    expect(hasMatcherValue({ value: ['pdf', 'docx'] })).toBe(true)
    expect(hasMatcherValue({ value: ['', 'docx'] })).toBe(true)
    expect(hasMatcherValue({ value: ['', '  '] })).toBe(false)
    expect(hasMatcherValue({ value: [] })).toBe(false)
  })

  it('缺失或非字符串类型不抛错，按无值处理', () => {
    expect(hasMatcherValue({})).toBe(false)
    expect(hasMatcherValue({ value: undefined })).toBe(false)
    expect(hasMatcherValue({ value: null })).toBe(false)
    expect(hasMatcherValue({ value: 0 })).toBe(false)
    expect(hasMatcherValue({ value: [1, 2] })).toBe(false)
  })
})
