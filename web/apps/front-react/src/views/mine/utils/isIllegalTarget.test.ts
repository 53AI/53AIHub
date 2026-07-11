import { describe, it, expect } from 'vitest'
import { isIllegalTarget } from './isIllegalTarget'

describe('isIllegalTarget', () => {
  it('根目录可以移动到任意子目录', () => {
    expect(isIllegalTarget('/', '/A')).toBe(false)
    expect(isIllegalTarget('/', '/A/B')).toBe(false)
  })

  it('源路径 == 目标路径视为非法', () => {
    expect(isIllegalTarget('/A', '/A')).toBe(true)
  })

  it('目标是源的后代视为非法', () => {
    expect(isIllegalTarget('/A', '/A/B')).toBe(true)
    expect(isIllegalTarget('/A/B', '/A/B/C')).toBe(true)
  })

  it('目标与源平级或同级视为合法', () => {
    expect(isIllegalTarget('/A/B', '/A')).toBe(false)
    expect(isIllegalTarget('/A/B', '/C')).toBe(false)
  })

  it('前缀相近但非后代视为合法', () => {
    // '/AB' 不是 '/A' 的后代（必须有分隔符）
    expect(isIllegalTarget('/A', '/AB')).toBe(false)
  })
})
